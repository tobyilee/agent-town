import { EventEmitter } from 'node:events';
import { short } from './activity.js';

const HISTORY_LIMIT = 40;

// Holds every agent (one per session, plus one per running subagent) and the
// activity it is doing right now. Agents carry a userId so a later multi-user
// office can merge stores from several developers.
export class Store extends EventEmitter {
  constructor({ userId = 'local', userName = 'me', idleAfterMs = 90_000, restAfterMs = 10 * 60_000, goneAfterMs = 30 * 60_000 } = {}) {
    super();
    this.userId = userId;
    this.userName = userName;
    this.idleAfterMs = idleAfterMs;
    this.restAfterMs = restAfterMs;
    this.goneAfterMs = goneAfterMs;
    this.agents = new Map();
  }

  get(id) {
    return this.agents.get(id);
  }

  ensure(id, info = {}, ts = Date.now()) {
    let a = this.agents.get(id);
    if (!a) {
      a = {
        id,
        userId: this.userId,
        userName: this.userName,
        kind: 'main',
        parentId: null,
        source: 'unknown',
        sessionId: id,
        name: 'agent',
        project: '',
        cwd: '',
        title: '',
        model: '',
        activity: 'idle',
        detail: 'Just arrived',
        since: ts,
        lastEventAt: ts,
        history: [],
        subagents: [],
      };
      this.agents.set(id, a);
    }
    Object.assign(a, Object.fromEntries(Object.entries(info).filter(([, v]) => v != null && v !== '')));
    this.changed();
    return a;
  }

  setActivity(id, activity, detail, ts = Date.now(), extra = {}) {
    const a = this.agents.get(id);
    if (!a) return;
    ts = Math.max(ts, a.lastEventAt - 1); // tolerate slightly out-of-order lines
    const d = short(detail, 160);
    if (a.activity !== activity || a.detail !== d) {
      if (a.activity !== activity) a.since = ts;
      a.activity = activity;
      a.detail = d;
      a.history.unshift({ t: ts, activity, detail: d, ...extra });
      if (a.history.length > HISTORY_LIMIT) a.history.length = HISTORY_LIMIT;
    }
    a.lastEventAt = Math.max(a.lastEventAt, ts);
    this.changed();
  }

  touch(id, ts = Date.now()) {
    const a = this.agents.get(id);
    if (a) a.lastEventAt = Math.max(a.lastEventAt, ts);
  }

  spawn(parentId, subId, info, ts = Date.now()) {
    const parent = this.agents.get(parentId);
    if (!parent) return null;
    const sub = this.ensure(subId, {
      kind: 'subagent',
      parentId,
      source: parent.source,
      sessionId: parent.sessionId,
      project: parent.project,
      cwd: parent.cwd,
      ...info,
    }, ts);
    if (!parent.subagents.includes(subId)) parent.subagents.push(subId);
    this.setActivity(subId, 'thinking', info.detail || 'Starting up', ts);
    return sub;
  }

  finish(subId, ts = Date.now()) {
    const sub = this.agents.get(subId);
    if (!sub) return;
    const parent = this.agents.get(sub.parentId);
    if (parent) parent.subagents = parent.subagents.filter((s) => s !== subId);
    this.agents.delete(subId);
    this.changed();
    return parent;
  }

  activeSubagents(parentId) {
    return (this.agents.get(parentId)?.subagents || []).filter((id) => this.agents.has(id));
  }

  // Quiet agents go idle: mid-turn silence after idleAfterMs, a finished turn
  // ("waiting for you") after restAfterMs. Sessions silent for goneAfterMs leave.
  tick(now = Date.now()) {
    for (const a of [...this.agents.values()]) {
      const quiet = now - a.lastEventAt;
      if (quiet > this.goneAfterMs) {
        if (a.kind === 'subagent') this.finish(a.id, now);
        else {
          for (const s of a.subagents) this.agents.delete(s);
          this.agents.delete(a.id);
          this.changed();
        }
      } else if (a.activity !== 'idle' && a.subagents.length === 0) {
        const waiting = a.activity === 'waiting';
        if (quiet <= (waiting ? this.restAfterMs : this.idleAfterMs)) continue;
        const before = a.lastEventAt;
        this.setActivity(a.id, 'idle', waiting ? 'Finished a while ago, nobody has replied' : 'No log activity for a while', before);
        a.lastEventAt = before;
      }
    }
  }

  snapshot() {
    return {
      user: { id: this.userId, name: this.userName },
      now: Date.now(),
      agents: [...this.agents.values()].map((a) => ({ ...a, history: a.history.slice(0, 15) })),
    };
  }

  changed() {
    this.emit('change');
  }
}
