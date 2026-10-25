import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { ClaudeSession, claudeFileInfo } from '../server/parsers/claude.js';
import { CodexSession, codexSessionId } from '../server/parsers/codex.js';
import { classifyCommand } from '../server/activity.js';

const ts = (s) => new Date(Date.UTC(2026, 9, 25, 6, 0, s)).toISOString();

test('claude: file paths map to sessions and subagent files', () => {
  assert.deepEqual(claudeFileInfo('/h/.claude/projects/-a-b/abc.jsonl'), { sessionId: 'abc', subFile: null });
  assert.deepEqual(claudeFileInfo('/h/.claude/projects/-a-b/abc/subagents/agent-1.jsonl'), { sessionId: 'abc', subFile: 'agent-1' });
});

test('claude: tool calls become activities, Task spawns a subagent', () => {
  const store = new Store();
  const s = new ClaudeSession(store, 'abc');
  const asst = (t, content, stop = 'tool_use') => s.handle({ type: 'assistant', timestamp: ts(t), cwd: '/u/dev/web', message: { content, stop_reason: stop } });
  s.handle({ type: 'user', timestamp: ts(0), cwd: '/u/dev/web', message: { content: 'Add dark mode' } });
  const a = store.get('claude-code:abc');
  assert.equal(a.activity, 'thinking');
  assert.equal(a.project, 'web');

  asst(1, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/u/dev/web/src/app.ts' } }]);
  assert.equal(a.activity, 'reading');
  assert.match(a.detail, /app\.ts/);

  asst(2, [{ type: 'tool_use', id: 't2', name: 'mcp__figma__get_tokens', input: {} }]);
  assert.equal(a.activity, 'mcp');
  assert.equal(a.detail, 'figma › get_tokens');

  asst(3, [{ type: 'tool_use', id: 't3', name: 'Task', input: { subagent_type: 'Explore', description: 'Find colors' } }]);
  assert.equal(a.activity, 'subagent');
  const subId = 'claude-code:abc:sub:t3';
  assert.equal(store.get(subId).name, 'Explore');

  s.handle({ type: 'assistant', timestamp: ts(4), message: { content: [{ type: 'tool_use', id: 'x', name: 'Grep', input: { pattern: 'color' } }] } }, 'agent-1');
  assert.equal(store.get(subId).activity, 'searching');

  s.handle({ type: 'user', timestamp: ts(5), message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'done' }] } });
  assert.equal(store.get(subId), undefined);
  assert.equal(a.activity, 'thinking');

  asst(6, [{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: '/u/dev/web/src/theme.ts' } }]);
  assert.equal(a.activity, 'editing');
  asst(7, [{ type: 'text', text: 'All done' }], 'end_turn');
  assert.equal(a.activity, 'waiting'); // old timestamp: no dwell
});

test('claude: ai-title sets the task title', () => {
  const store = new Store();
  const s = new ClaudeSession(store, 'xyz');
  s.handle({ type: 'ai-title', aiTitle: 'Fix login bug', sessionId: 'xyz' });
  assert.equal(store.get('claude-code:xyz').title, 'Fix login bug');
});

test('codex: rollout lines become activities', () => {
  const store = new Store();
  const sid = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  assert.equal(codexSessionId(`/h/.codex/sessions/2026/10/25/rollout-2026-10-25T06-00-00-${sid}.jsonl`), sid);
  const s = new CodexSession(store, sid);
  const a = store.get(`codex:${sid}`);
  s.handle({ timestamp: ts(0), type: 'session_meta', payload: { id: sid, cwd: '/u/dev/mobile', originator: 'codex_cli_rs' } });
  assert.equal(a.project, 'mobile');
  s.handle({ timestamp: ts(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the flaky test' }] } });
  assert.equal(a.activity, 'thinking');
  assert.equal(a.title, 'Fix the flaky test');
  s.handle({ timestamp: ts(2), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'rg -n login tests'] }) } });
  assert.equal(a.activity, 'searching');
  s.handle({ timestamp: ts(3), type: 'event_msg', payload: { type: 'mcp_tool_call_begin', invocation: { server: 'github', tool: 'list_runs' } } });
  assert.equal(a.activity, 'mcp');
  s.handle({ timestamp: ts(4), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: tests/login.spec.ts\n*** End Patch' } });
  assert.equal(a.activity, 'editing');
  assert.equal(a.detail, 'Editing login.spec.ts');
  s.handle({ timestamp: ts(5), type: 'event_msg', payload: { type: 'task_complete' } });
  assert.equal(a.activity, 'waiting');
});

test('shell commands are classified', () => {
  assert.equal(classifyCommand('cat src/a.ts').activity, 'reading');
  assert.equal(classifyCommand(['bash', '-lc', 'grep -r foo .']).activity, 'searching');
  assert.equal(classifyCommand('npm test').activity, 'running');
  assert.equal(classifyCommand("sed -i 's/a/b/' x").activity, 'running');
});

test('store: quiet agents go idle, then leave', () => {
  const store = new Store({ idleAfterMs: 1000, goneAfterMs: 5000 });
  store.ensure('a', {}, 0);
  store.setActivity('a', 'editing', 'x', 0);
  store.tick(2000);
  assert.equal(store.get('a').activity, 'idle');
  store.tick(6000);
  assert.equal(store.get('a'), undefined);
});

test('store: a finished turn waits for the user, then rests', () => {
  const store = new Store({ idleAfterMs: 1000, restAfterMs: 3000, goneAfterMs: 10_000 });
  store.ensure('a', {}, 0);
  store.setActivity('a', 'waiting', 'Done', 0);
  store.tick(2000);
  assert.equal(store.get('a').activity, 'waiting');
  store.tick(4000);
  assert.equal(store.get('a').activity, 'idle');
  assert.equal(store.get('a').since, 0);
});
