import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, ZONES, FURNITURE, DOOR, SEATS, buildBlocked } from '../client/office-map.js';

const blocked = buildBlocked();

function reachable(from) {
  const seen = new Set([from.join()]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [x + dx, y + dy];
      if (n[0] < 0 || n[1] < 0 || n[0] >= COLS || n[1] >= ROWS || blocked[n[1]][n[0]] || seen.has(n.join())) continue;
      seen.add(n.join());
      queue.push(n);
    }
  }
  return seen;
}

test('map: furniture stays inside the map', () => {
  for (const [type, x, y, w, h] of FURNITURE) {
    assert.ok(x >= 0 && y >= 0 && x + w <= COLS && y + h <= ROWS, `${type} at ${x},${y} is outside the map`);
  }
});

test('map: every spot is free, inside its zone, and reachable from the door', () => {
  const fromDoor = reachable(DOOR);
  const taken = new Set();
  for (const z of ZONES) {
    const [zx, zy, zw, zh] = z.rect;
    for (const [x, y] of z.spots) {
      const where = `${z.id} spot ${x},${y}`;
      assert.ok(x >= zx && x < zx + zw && y >= zy && y < zy + zh, `${where} is outside the zone`);
      assert.ok(!blocked[y][x], `${where} is blocked`);
      assert.ok(fromDoor.has(`${x},${y}`), `${where} cannot be reached from the door`);
      assert.ok(!taken.has(`${x},${y}`), `${where} is used twice`);
      taken.add(`${x},${y}`);
    }
  }
});

test('map: every activity has a zone with spots', () => {
  for (const a of ['thinking', 'talking', 'reading', 'editing', 'searching', 'running', 'mcp', 'subagent', 'waiting', 'idle']) {
    const z = ZONES.find((zone) => zone.activities.includes(a));
    assert.ok(z && z.spots.length >= 5, `no roomy zone for ${a}`);
  }
});

// Measured on real logs: thinking is the most common activity; 95% of the time
// at most 15 agents (subagents included) think at once. Rare peaks stand anywhere
// free in the room.
test('map: the Think Tank has room for the crowd', () => {
  const spots = (id) => ZONES.find((z) => z.id === id).spots.length;
  assert.ok(spots('think') >= 20, `think tank has ${spots('think')} spots`);
  for (const z of ZONES) assert.ok(spots('think') >= z.spots.length, `${z.id} has more spots than the think tank`);
});

test('map: seats sit on a spot so characters use them', () => {
  const spots = new Set(ZONES.flatMap((z) => z.spots.map(([x, y]) => `${x},${y}`)));
  for (const [type, x, y, w] of FURNITURE.filter(([t]) => SEATS.has(t))) {
    const used = Array.from({ length: w }, (_, i) => `${x + i},${y}`).some((k) => spots.has(k));
    assert.ok(used, `${type} at ${x},${y} has no spot`);
  }
});
