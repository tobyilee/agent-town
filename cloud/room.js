// The shared office: one entry per person, each holding that person's agents
// as their agent-town-client last pushed them. Plain JavaScript with no
// Cloudflare APIs, so node --test covers it; worker.js keeps it in a Durable
// Object and stores each person's entry under `user:<id>`.

export const STALE_MS = 60_000; // a person with no push for this long leaves
export const MAX_AGENTS = 200;  // per person
const HISTORY_LIMIT = 15;
const NAME_MAX = 40;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, shift) => (Number.isFinite(v) ? v + shift : undefined);

// Ids get the person's id in front, so the same session id from two laptops
// never collides, and subagents still find their parent.
function normalize(a, userId, userName, shift) {
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id) throw bad('every agent needs a string id');
  const pre = (id) => `${userId}:${id}`;
  return {
    ...a,
    id: pre(a.id),
    parentId: typeof a.parentId === 'string' ? pre(a.parentId) : null,
    subagents: Array.isArray(a.subagents) ? a.subagents.filter((s) => typeof s === 'string').map(pre) : [],
    userId,
    userName,
    name: str(a.name, 80) || 'agent',
    detail: str(a.detail),
    title: str(a.title, 200),
    since: num(a.since, shift),
    lastEventAt: num(a.lastEventAt, shift),
    history: (Array.isArray(a.history) ? a.history : []).slice(0, HISTORY_LIMIT).map((h) => ({ ...h, t: num(h?.t, shift), detail: str(h?.detail) })),
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
    const agents = env.agents.map((a) => normalize(a, id, name, shift));
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
