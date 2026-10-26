import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, STALE_MS, MAX_AGENTS } from '../cloud/room.js';

const T = 1_800_000_000_000;

function agent(id, extra = {}) {
  return { id, kind: 'main', parentId: null, sessionId: id, name: 'Claude', activity: 'thinking', detail: '', since: T - 5000, lastEventAt: T - 1000, history: [{ t: T - 5000, activity: 'thinking', detail: 'hm' }], subagents: [], userId: 'ignored', userName: 'ignored', ...extra };
}

function envelope(id, name, agents, now = T) {
  return { user: { id, name }, now, agents };
}

test('room: agents from several people are merged under each name', () => {
  const room = new Room();
  room.push(envelope('u1', 'Toby', [agent('claude-code:a')]), T);
  room.push(envelope('u2', 'Mina', [agent('claude-code:a'), agent('codex:b')]), T);
  const snap = room.snapshot(T);
  assert.equal(snap.mode, 'cloud');
  assert.deepEqual(snap.users.map((u) => u.name).sort(), ['Mina', 'Toby']);
  assert.equal(snap.agents.length, 3);
  // The same local id from two people does not collide.
  assert.equal(new Set(snap.agents.map((a) => a.id)).size, 3);
  for (const a of snap.agents) assert.equal(a.userName, a.userId === 'u1' ? 'Toby' : 'Mina');
});

test('room: subagents keep their parent after the ids get a prefix', () => {
  const room = new Room();
  room.push(envelope('u1', 'Toby', [
    agent('claude-code:a', { subagents: ['claude-code:a/sub1'] }),
    agent('claude-code:a/sub1', { kind: 'subagent', parentId: 'claude-code:a' }),
  ]), T);
  const { agents } = room.snapshot(T);
  const ids = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    if (a.parentId) assert.ok(ids.has(a.parentId), `${a.parentId} is missing`);
    for (const s of a.subagents) assert.ok(ids.has(s), `${s} is missing`);
  }
});

test('room: times from a client whose clock runs ahead are moved to server time', () => {
  const room = new Room();
  const ahead = 5 * 60_000;
  room.push(envelope('u1', 'Toby', [agent('x', { since: T + ahead - 30_000, lastEventAt: T + ahead - 2000, history: [{ t: T + ahead - 30_000, activity: 'waiting', detail: '' }] })], T + ahead), T);
  const [a] = room.snapshot(T).agents;
  assert.equal(a.since, T - 30_000);
  assert.equal(a.lastEventAt, T - 2000);
  assert.equal(a.history[0].t, T - 30_000);
});

test('room: a person who stops pushing leaves after STALE_MS', () => {
  const room = new Room();
  room.push(envelope('u1', 'Toby', [agent('x')]), T);
  room.push(envelope('u2', 'Mina', [agent('y')]), T + STALE_MS - 1000);
  assert.deepEqual(room.prune(T + STALE_MS + 1), ['u1']);
  assert.deepEqual(room.snapshot(T + STALE_MS + 1).users.map((u) => u.id), ['u2']);
});

test('room: a leave push removes the person at once', () => {
  const room = new Room();
  room.push(envelope('u1', 'Toby', [agent('x')]), T);
  room.push({ ...envelope('u1', 'Toby', []), leave: true }, T);
  assert.equal(room.snapshot(T).users.length, 0);
});

test('room: a room rebuilt from storage gives the same snapshot', () => {
  const room = new Room();
  room.push(envelope('u1', 'Toby', [agent('x', { subagents: ['x/s'] }), agent('x/s', { kind: 'subagent', parentId: 'x' })]), T);
  room.push(envelope('u2', 'Mina', [agent('y')], T + 3000), T);
  const stored = JSON.parse(JSON.stringify(room.toJSON()));
  assert.deepEqual(Room.from(stored).snapshot(T), room.snapshot(T));
});

test('room: bad envelopes are rejected with status 400', () => {
  const room = new Room();
  const bad = [null, {}, { user: { id: '../x', name: 'a' }, now: T, agents: [] }, { user: { id: 'u1' }, now: T, agents: 'no' }, envelope('u1', 'a', [{ nope: 1 }])];
  for (const env of bad) assert.throws(() => room.push(env, T), (e) => e.status === 400);
  const many = Array.from({ length: MAX_AGENTS + 1 }, (_, i) => agent(`a${i}`));
  assert.throws(() => room.push(envelope('u1', 'a', many), T), (e) => e.status === 400);
});

test('room: a hostile push cannot put markup or odd types in front of viewers', () => {
  const room = new Room();
  const evil = '"><img src=x onerror=alert(1)>';
  room.push(envelope('u1', 'Eve', [{
    id: 'x', activity: evil, kind: evil, source: evil, sessionId: { no: 1 }, cwd: 42, project: ['a'],
    since: 'soon', history: [{ t: 'now', activity: evil, detail: 7, extra: evil }], isAdmin: true, __proto__: { polluted: true },
  }]), T);
  const [a] = room.snapshot(T).agents;
  assert.equal(a.activity, 'idle');
  assert.equal(a.kind, 'main');
  assert.equal(a.source, 'claude-code');
  assert.equal(a.sessionId, 'x');
  assert.equal(a.cwd, '');
  assert.equal(a.project, '');
  assert.equal(a.since, T);
  assert.deepEqual(a.history, [{ t: T, activity: 'idle', detail: '' }]);
  assert.equal('isAdmin' in a, false);
  // Known activities still get through.
  room.push(envelope('u2', 'Bob', [agent('y', { activity: 'running' })]), T);
  assert.equal(room.snapshot(T).agents.find((x) => x.userId === 'u2').activity, 'running');
});

test('room: a missing name falls back and long names are cut', () => {
  const room = new Room();
  room.push(envelope('u1', '', [agent('x')]), T);
  room.push(envelope('u2', 'x'.repeat(200), [agent('y')]), T);
  const names = room.snapshot(T).users.map((u) => u.name);
  assert.ok(names.includes('someone'));
  assert.ok(names.every((n) => n.length <= 40));
});
