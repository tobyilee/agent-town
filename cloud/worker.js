import { DurableObject } from 'cloudflare:workers';
import { Room } from './room.js';

// The shared Agent Town office on Cloudflare.
// - Static files (the office page in ../client) come from Workers assets.
// - /api/push: an agent-town-client sends one person's agents (team key in
//   Authorization).
// - /api/live: the office page opens a WebSocket, sends { type: 'auth', key }
//   first, and then gets a snapshot after every change.
// Everything lives in one Durable Object, so every viewer sees the same office.

const MAX_BODY = 1_000_000;
const AUTH_WINDOW_MS = 5000;  // a viewer has this long to send the key
const BROADCAST_MS = 250;     // coalesce snapshots from many pushes
const ALARM_MS = 5000;

function json(code, body) {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// Constant-time compare: hash both sides so the lengths match.
async function keyMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/mode') return json(200, { mode: 'cloud' });
    if (url.pathname === '/api/push' || url.pathname === '/api/live') {
      return env.OFFICE.get(env.OFFICE.idFromName('office')).fetch(req);
    }
    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not found' });
    return env.ASSETS.fetch(req);
  },
};

export class Office extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = new Room();
    this.pending = null;
    // The object may have been evicted between pushes: rebuild the office from
    // storage before handling anything.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list({ prefix: 'user:' });
      this.room = Room.from(Object.fromEntries([...stored].map(([k, v]) => [k.slice(5), v])));
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    if (!this.env.TEAM_KEY) return json(500, { error: 'TEAM_KEY is not set: run `wrangler secret put TEAM_KEY`' });
    const { pathname } = new URL(req.url);
    if (pathname === '/api/push') return this.push(req);
    if (pathname === '/api/live') return this.live(req);
    return json(404, { error: 'not found' });
  }

  async push(req) {
    if (req.method !== 'POST') return json(405, { error: 'use POST' });
    const auth = req.headers.get('authorization') || '';
    if (!(await keyMatches(auth.replace(/^Bearer\s+/i, ''), this.env.TEAM_KEY))) return json(401, { error: 'wrong team key' });
    if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return json(413, { error: 'push is too large' });
    const text = await req.text();
    if (text.length > MAX_BODY) return json(413, { error: 'push is too large' });
    let env;
    try { env = JSON.parse(text); } catch { return json(400, { error: 'send JSON' }); }
    const now = Date.now();
    let id;
    try { id = this.room.push(env, now); } catch (e) { return json(e.status || 400, { error: e.message }); }
    const entry = this.room.users.get(id);
    if (entry) await this.ctx.storage.put(`user:${id}`, entry);
    else await this.ctx.storage.delete(`user:${id}`);
    await this.prune(now);
    await this.ensureAlarm();
    this.scheduleBroadcast();
    return json(200, { ok: true, agents: entry?.agents.length ?? 0, users: this.room.users.size });
  }

  async live(req) {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json(426, { error: 'open a WebSocket' });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ auth: false, at: Date.now() });
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const att = ws.deserializeAttachment() || {};
    if (att.auth) return; // viewers only listen
    let msg;
    try { msg = JSON.parse(message); } catch {}
    if (msg?.type !== 'auth' || !(await keyMatches(msg.key, this.env.TEAM_KEY))) {
      ws.close(4001, 'wrong team key');
      return;
    }
    ws.serializeAttachment({ auth: true, at: att.at });
    ws.send(JSON.stringify(this.room.snapshot(Date.now())));
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code); } catch {}
  }

  webSocketError(ws) {
    try { ws.close(1011); } catch {}
  }

  // Runs every few seconds while anyone is here: drops people who stopped
  // pushing and viewers who never sent the key.
  async alarm() {
    const now = Date.now();
    await this.prune(now);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (!att.auth && now - (att.at || 0) > AUTH_WINDOW_MS) {
        try { ws.close(4001, 'send the team key first'); } catch {}
      }
    }
    if (this.room.users.size || this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(now + ALARM_MS);
  }

  async prune(now) {
    const gone = this.room.prune(now);
    if (!gone.length) return;
    await this.ctx.storage.delete(gone.map((id) => `user:${id}`));
    this.scheduleBroadcast();
  }

  async ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
  }

  scheduleBroadcast() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      const data = JSON.stringify(this.room.snapshot(Date.now()));
      for (const ws of this.ctx.getWebSockets()) {
        if (!ws.deserializeAttachment()?.auth) continue;
        try { ws.send(data); } catch {}
      }
    }, BROADCAST_MS);
  }
}
