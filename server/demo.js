import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Writes fake but format-accurate Claude Code and Codex logs so the office can
// be tried without a live agent: `npm run demo`.
export function startDemo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-town-demo-'));
  const claudeRoot = path.join(root, 'claude', 'projects');
  const codexRoot = path.join(root, 'codex', 'sessions');

  const append = (file, rec) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...rec }) + '\n');
  };

  const claudeBot = (project) => {
    const sid = randomUUID();
    const dir = path.join(claudeRoot, `-Users-dev-${project}`);
    const file = path.join(dir, `${sid}.jsonl`);
    const cwd = `/Users/dev/${project}`;
    const asst = (content, stop = 'tool_use') => append(file, { type: 'assistant', cwd, sessionId: sid, message: { model: 'claude-opus-5-5', role: 'assistant', content, stop_reason: stop } });
    const user = (content) => append(file, { type: 'user', cwd, sessionId: sid, message: { role: 'user', content } });
    const tool = (name, input) => { const id = 'toolu_' + randomUUID().slice(0, 8); asst([{ type: 'tool_use', id, name, input }]); return id; };
    const result = (id) => user([{ type: 'tool_result', tool_use_id: id, content: 'ok' }]);
    let pendingTask = null;
    let subFile = null;
    const steps = [
      () => { user('Add dark mode to the settings page'); append(file, { type: 'ai-title', aiTitle: 'Add dark mode', sessionId: sid }); },
      () => asst([{ type: 'thinking', thinking: 'The settings page lives in src/settings. I should look at the theme provider first.' }]),
      () => result(tool('Grep', { pattern: 'ThemeProvider' })),
      () => result(tool('Read', { file_path: `${cwd}/src/theme/provider.tsx` })),
      () => {
        pendingTask = tool('Task', { subagent_type: 'Explore', description: 'Find every hard-coded color' });
        subFile = path.join(dir, sid, 'subagents', `agent-${randomUUID().slice(0, 8)}.jsonl`);
      },
      () => append(subFile, { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: '#[0-9a-f]{6}' } }] } }),
      () => append(subFile, { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: `${cwd}/src/components/Button.tsx` } }] } }),
      () => append(subFile, { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Summarizing the colors I found' }] } }),
      () => result(pendingTask),
      () => result(tool('mcp__figma__get_design_tokens', { file: 'Design System' })),
      () => result(tool('Edit', { file_path: `${cwd}/src/theme/tokens.ts` })),
      () => result(tool('Write', { file_path: `${cwd}/src/settings/DarkModeToggle.tsx` })),
      () => result(tool('Bash', { command: 'npm test -- settings' })),
      () => asst([{ type: 'text', text: 'Dark mode is in. I added a toggle to Settings and moved colors into tokens.' }], 'end_turn'),
      () => {},
      () => {},
    ];
    let i = 0;
    return () => { steps[i % steps.length](); i++; };
  };

  const codexBot = (project) => {
    const sid = randomUUID();
    const d = new Date();
    const dir = path.join(codexRoot, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    const file = path.join(dir, `rollout-${d.toISOString().slice(0, 19).replace(/:/g, '-')}-${sid}.jsonl`);
    const cwd = `/Users/dev/${project}`;
    const item = (payload) => append(file, { type: 'response_item', payload });
    const event = (payload) => append(file, { type: 'event_msg', payload });
    const call = (name, args) => item({ type: 'function_call', name, call_id: 'c' + Math.random(), arguments: JSON.stringify(args) });
    append(file, { type: 'session_meta', payload: { id: sid, cwd, originator: 'codex_cli_rs', cli_version: '0.50.0' } });
    const steps = [
      () => item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the flaky login test' }] }),
      () => item({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Looking for the login test and its timing assumptions' }] }),
      () => call('shell', { command: ['bash', '-lc', 'rg -n "login" tests'] }),
      () => call('shell', { command: ['bash', '-lc', 'sed -n 1,80p tests/login.spec.ts'] }),
      () => event({ type: 'mcp_tool_call_begin', invocation: { server: 'github', tool: 'list_workflow_runs' } }),
      () => item({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: tests/login.spec.ts\n@@\n*** End Patch' }),
      () => call('shell', { command: ['bash', '-lc', 'npm test -- login'] }),
      () => item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The test now waits for the redirect instead of sleeping.' }] }),
      () => event({ type: 'task_complete' }),
      () => {},
      () => {},
    ];
    let i = 0;
    return () => { steps[i % steps.length](); i++; };
  };

  const bots = [claudeBot('web-app'), claudeBot('api-server'), codexBot('mobile')];
  bots.forEach((b, i) => setTimeout(() => { b(); setInterval(b, 2600 + i * 700); }, i * 1200));

  return [
    { type: 'claude-code', enabled: true, path: claudeRoot },
    { type: 'codex', enabled: true, path: codexRoot },
  ];
}
