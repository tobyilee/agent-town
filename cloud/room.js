// The shared office: one entry per person, each holding that person's agents
// as their agent-town-client last pushed them. Plain JavaScript with no
// Cloudflare APIs, so node --test covers it; worker.js keeps it in a Durable
// Object and stores each person's entry under `user:<id>`.

import { ZONES } from '../client/office-map.js';

export const STALE_MS = 60_000; // a person with no push for this long leaves
export const MAX_AGENTS = 200;  // per person
const HISTORY_LIMIT = 15;
const NAME_MAX = 40;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// The rooms of the office decide which activities exist.
const ACTIVITIES = new Set(ZONES.flatMap((z) => z.activities));
const SOURCES = new Set(['claude-code', 'codex']);

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, shift, fallback) => (Number.isFinite(v) ? v + shift : fallback);
const activity = (v) => (ACTIVITIES.has(v) ? v : 'idle');

// Anyone with the team key can push, and every viewer draws what they push, so
// only known fields of known types get through. Ids get the person's id in
// front, so the same session id from two laptops never collides, and
// subagents still find their parent.
function normalize(a, userId, userName, shift, now) {
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id) throw bad('every agent needs a string id');
  const pre = (id) => `${userId}:${str(id, 200)}`;
  return {
    id: pre(a.id),
    userId,
    userName,
    kind: a.kind === 'subagent' ? 'subagent' : 'main',
    parentId: typeof a.parentId === 'string' ? pre(a.parentId) : null,
    source: SOURCES.has(a.source) ? a.source : 'claude-code',
    sessionId: str(a.sessionId, 200) || str(a.id, 200),
    name: str(a.name, 80) || 'agent',
    project: str(a.project, 120),
    cwd: str(a.cwd),
    branch: str(a.branch, 200),
    model: str(a.model, 120),
    title: str(a.title, 200),
    activity: activity(a.activity),
    detail: str(a.detail),
    stay: a.stay === true,
    since: num(a.since, shift, now),
    lastEventAt: num(a.lastEventAt, shift, now),
    history: (Array.isArray(a.history) ? a.history : []).slice(0, HISTORY_LIMIT)
      .map((h) => ({ t: num(h?.t, shift, now), activity: activity(h?.activity), detail: str(h?.detail) })),
    subagents: Array.isArray(a.subagents) ? a.subagents.filter((s) => typeof s === 'string').slice(0, MAX_AGENTS).map(pre) : [],
  };
}

export class Room {
  constructor(users = {}) {
    this.users = new Map(Object.entries(users)); // userId -> { name, lastPush, agents }
  }

  static from(json) {
    return new Room(json || {});
  }

  toJSON() {
    return Object.fromEntries(this.users);
  }

  // Returns the person's id. `env.now` is the client's clock when it sent the
  // push: the difference to ours moves every timestamp into server time.
  push(env, serverNow = Date.now()) {
    if (!env || typeof env !== 'object') throw bad('send a JSON object');
    const id = env.user?.id;
    if (typeof id !== 'string' || !USER_ID.test(id)) throw bad('user.id must be 1-64 letters, digits, _ or -');
    if (env.leave === true) {
      this.users.delete(id);
      return id;
    }
    if (!Array.isArray(env.agents)) throw bad('agents must be an array');
    if (env.agents.length > MAX_AGENTS) throw bad(`at most ${MAX_AGENTS} agents per person`);
    const name = str(env.user.name).trim().slice(0, NAME_MAX) || 'someone';
    const shift = Number.isFinite(env.now) ? serverNow - env.now : 0;
    const agents = env.agents.map((a) => normalize(a, id, name, shift, serverNow));
    this.users.set(id, { name, lastPush: serverNow, agents });
    return id;
  }

  // Removes people who stopped pushing; returns their ids.
  prune(now = Date.now()) {
    const gone = [];
    for (const [id, u] of this.users) if (now - u.lastPush > STALE_MS) gone.push(id);
    for (const id of gone) this.users.delete(id);
    return gone;
  }

  snapshot(now = Date.now()) {
    const users = [...this.users].map(([id, u]) => ({ id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
    return { mode: 'cloud', now, users, agents: [...this.users.values()].flatMap((u) => u.agents) };
  }
}
