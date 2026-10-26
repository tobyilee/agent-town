import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pusher } from '../sync/pusher.js';

function setup(agents) {
  const sent = [];
  const pusher = new Pusher({
    target: () => ({ server: 'https://office.example', key: 'k' }),
    envelope: () => ({ user: { id: 'u1', name: 'Toby' }, now: Date.now(), agents: agents() }),
    fetchFn: async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ users: 1 }) }; },
  });
  return { pusher, sent };
}

test('pusher: a push with nothing new is skipped, a real change is sent', async () => {
  let a = [{ id: 'x', activity: 'thinking', lastEventAt: 1 }];
  const { pusher, sent } = setup(() => a);
  pusher.force = true;
  await pusher.send();
  assert.equal(sent.length, 1);
  a = [{ id: 'x', activity: 'thinking', lastEventAt: 2 }]; // only the clock moved
  await pusher.send();
  assert.equal(sent.length, 1);
  a = [{ id: 'x', activity: 'editing', lastEventAt: 3 }];
  await pusher.send();
  assert.equal(sent.length, 2);
});

test('pusher: the heartbeat is sent even when nothing changed', async () => {
  const { pusher, sent } = setup(() => [{ id: 'x', activity: 'idle' }]);
  pusher.force = true;
  await pusher.send();
  pusher.force = true;
  await pusher.send();
  assert.equal(sent.length, 2);
});

test('pusher: after a failed push the same state is sent again', async () => {
  const sent = [];
  let fail = true;
  const pusher = new Pusher({
    target: () => ({ server: 'https://office.example', key: 'k' }),
    envelope: () => ({ user: { id: 'u1', name: 'Toby' }, now: Date.now(), agents: [{ id: 'x' }] }),
    fetchFn: async (url, opts) => {
      sent.push(opts.body);
      return fail ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, json: async () => ({ users: 1 }) };
    },
  });
  await pusher.send();
  assert.equal(pusher.status.error, 'wrong team key');
  fail = false;
  await pusher.send();
  assert.equal(pusher.status.state, 'ok');
  assert.equal(sent.length, 2);
});
