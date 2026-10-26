#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, localHost, readSettings, serveStatic } from '../server/http.js';
import { Store } from '../server/store.js';
import { Watcher } from '../server/watcher.js';
import { AGENT_TYPES } from '../server/config.js';
import { startDemo } from '../server/demo.js';
import { clientConfigPath, loadClientConfig, normalizeClient, saveClientConfig } from './config.js';
import { blockReason, shareable } from './filter.js';
import { Pusher } from './pusher.js';

// agent-town-client: reads this computer's Claude Code and Codex logs, like the
// local office does, and pushes the agents you share to a shared office on
// Cloudflare. Its settings page (name, office URL, team key, what to block)
// runs on 127.0.0.1 only.

const PAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page');

const demo = process.argv.includes('--demo');
const cfgFile = clientConfigPath();
let cfg = loadClientConfig(cfgFile);
const portArg = process.argv.indexOf('--port');
if (portArg > -1) cfg.port = Number(process.argv[portArg + 1]);
const demoSources = demo ? startDemo() : null;

const store = new Store({
  userId: cfg.user.id,
  userName: cfg.user.name,
  idleAfterMs: cfg.idleAfterSeconds * 1000,
  restAfterMs: cfg.restAfterMinutes * 60_000,
  goneAfterMs: cfg.goneAfterMinutes * 60_000,
});

let watcher;
async function startWatcher() {
  watcher?.stop();
  const sources = (demoSources || cfg.agents).filter((a) => a.enabled);
  watcher = new Watcher(store, { sources, activeWindowMs: cfg.activeWindowMinutes * 60_000 });
  for (const a of [...store.agents.values()]) if (!sources.some((s) => s.type === a.source)) store.agents.delete(a.id);
  await watcher.start();
  console.log(`watching: ${sources.map((s) => `${s.type} (${s.path})`).join(', ') || 'nothing'}`);
}

const pusher = new Pusher({
  target: () => ({ server: cfg.server, key: cfg.key }),
  envelope: () => ({ user: cfg.user, now: Date.now(), agents: shareable(store.snapshot().agents, cfg) }),
  onStatus: (s) => console.log(s.state === 'ok' ? `syncing to ${cfg.server} as ${cfg.user.name}` : `not syncing: ${s.error}`),
});
store.on('change', () => pusher.changed());

// Every session on this computer, blocked or not, so the page can unblock them.
// A fixed order, so rows do not move under the mouse while agents work.
function sessions() {
  const all = store.snapshot().agents;
  const shared = new Set(shareable(all, cfg).map((a) => a.id));
  const label = (a) => a.project || a.cwd || a.name;
  return all.filter((a) => a.kind !== 'subagent').sort((a, b) => label(a).localeCompare(label(b)) || a.sessionId.localeCompare(b.sessionId)).map((a) => ({
    id: a.id, sessionId: a.sessionId, source: a.source, name: a.name, project: a.project, title: a.title, cwd: a.cwd,
    activity: a.activity, lastEventAt: a.lastEventAt, subagents: a.subagents.length,
    shared: shared.has(a.id), reason: blockReason(a, cfg),
  }));
}

// The key never goes back to the page: it only learns whether one is set.
function publicConfig() {
  const { key, ...rest } = cfg;
  return { ...rest, keySet: !!key };
}

function save(next) {
  cfg = normalizeClient(next);
  store.userName = cfg.user.name;
  saveClientConfig(cfgFile, cfg);
  pusher.changed();
}

async function handle(req, res) {
  if (!localHost(req)) return json(res, 403, { error: 'agent-town-client only answers on localhost' });
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') {
    return json(res, 200, { config: publicConfig(), status: pusher.status, sessions: sessions(), now: Date.now(), demo });
  }
  if (url.pathname === '/api/config') {
    if (req.method === 'GET') return json(res, 200, { config: publicConfig(), types: Object.fromEntries(Object.entries(AGENT_TYPES).map(([k, v]) => [k, v.label])), file: cfgFile, demo });
    if (req.method !== 'POST') return json(res, 405, { error: 'use GET or POST' });
    try {
      const body = await readSettings(req, 'agent-town-client');
      const agentsChanged = body.agents && JSON.stringify(body.agents) !== JSON.stringify(cfg.agents);
      save({
        ...cfg,
        server: body.server ?? cfg.server,
        // An empty key field means "keep the one I have"; clearKey removes it.
        key: body.clearKey ? '' : (typeof body.key === 'string' && body.key.trim() ? body.key : cfg.key),
        user: { ...cfg.user, name: body.user?.name ?? cfg.user.name },
        agents: body.agents ?? cfg.agents,
        blockedFolders: body.blockedFolders ?? cfg.blockedFolders,
      });
      if (agentsChanged) await startWatcher();
      return json(res, 200, { config: publicConfig() });
    } catch (e) {
      return json(res, e.status || 400, { error: String(e.message || e) });
    }
  }
  if (url.pathname === '/api/block') {
    if (req.method !== 'POST') return json(res, 405, { error: 'use POST' });
    try {
      const { sessionId, blocked } = await readSettings(req, 'agent-town-client');
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is missing');
      const rest = cfg.blockedSessions.filter((s) => s !== sessionId);
      save({ ...cfg, blockedSessions: blocked ? [...rest, sessionId] : rest });
      return json(res, 200, { blockedSessions: cfg.blockedSessions });
    } catch (e) {
      return json(res, e.status || 400, { error: String(e.message || e) });
    }
  }
  serveStatic(res, PAGE_DIR, url.pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('request failed:', e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// Leave the office at once instead of after a minute of silence.
let leaving = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (leaving) process.exit(1);
    leaving = true;
    console.log('leaving the shared office…');
    await pusher.leave();
    process.exit(0);
  });
}

await startWatcher();
server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`agent-town-client settings: http://localhost:${cfg.port}${demo ? '  (demo mode)' : ''}`);
  if (!cfg.server || !cfg.key) console.log('Open that page to set your name, the office URL and the team key.');
  pusher.start();
});
