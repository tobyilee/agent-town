import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { blockReason, shareable } from '../sync/filter.js';

const main = (id, cwd, extra = {}) => ({ id, kind: 'main', parentId: null, sessionId: id.split(':')[1], cwd, subagents: [], userId: 'local', userName: 'me', ...extra });
const sub = (id, parent) => ({ ...parent, id, kind: 'subagent', parentId: parent.id, subagents: [] });

const user = { id: 'u1', name: 'Toby' };

test('filter: a blocked folder blocks the whole tree, matched on whole path parts', () => {
  const cfg = { user, blockedSessions: [], blockedFolders: ['/work/secret/'] };
  assert.equal(blockReason(main('claude-code:a', '/work/secret'), cfg), 'folder');
  assert.equal(blockReason(main('claude-code:a', '/work/secret/api'), cfg), 'folder');
  assert.equal(blockReason(main('claude-code:a', '/work/secret-2'), cfg), null);
  assert.equal(blockReason(main('claude-code:a', '/work'), cfg), null);
});

test('filter: ~ in a blocked folder means the home folder', () => {
  const cfg = { user, blockedSessions: [], blockedFolders: ['~/clients'] };
  assert.equal(blockReason(main('codex:b', path.join(os.homedir(), 'clients', 'acme')), cfg), 'folder');
});

test('filter: a blocked session is blocked, and its subagents with it', () => {
  const a = main('claude-code:aaa', '/work/app');
  const s = sub('claude-code:aaa/sub1', a);
  const b = main('claude-code:bbb', '/work/app');
  const cfg = { user, blockedSessions: ['aaa'], blockedFolders: [] };
  assert.deepEqual(shareable([a, s, b], cfg).map((x) => x.id), ['claude-code:bbb']);
});

test('filter: while any folder is blocked, an agent with no folder yet is held back', () => {
  const a = main('claude-code:a', '');
  assert.equal(blockReason(a, { user, blockedSessions: [], blockedFolders: ['/work/secret'] }), 'no-folder-yet');
  assert.equal(blockReason(a, { user, blockedSessions: [], blockedFolders: [] }), null);
});

test('filter: a subagent whose parent is held back is held back too', () => {
  const a = main('claude-code:a', '/work/secret');
  const s = { ...sub('claude-code:a/s', a), cwd: '/work/open', sessionId: 'other' };
  assert.deepEqual(shareable([a, s], { user, blockedSessions: [], blockedFolders: ['/work/secret'] }), []);
});

test('filter: shared agents carry the name and id from the config', () => {
  const [a] = shareable([main('claude-code:a', '/work/app')], { user, blockedSessions: [], blockedFolders: [] });
  assert.equal(a.userId, 'u1');
  assert.equal(a.userName, 'Toby');
});
