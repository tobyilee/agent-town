import { classifyCommand, short } from '../activity.js';

// Codex CLI writes one "rollout" JSONL file per session:
//   ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl
// Each line is { timestamp, type, payload } where type is session_meta,
// turn_context, response_item or event_msg. Older builds wrote the response
// items directly (no wrapper), which handle() also accepts.
export function codexSessionId(path) {
  const m = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return m ? m[1] : path.split(/[\\/]/).pop().replace(/\.jsonl$/, '');
}

function parseArgs(args) {
  if (args && typeof args === 'object') return args;
  try { return JSON.parse(args || '{}'); } catch { return { raw: args }; }
}

function patchFiles(text) {
  return [...String(text || '').matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => m[1].trim().split('/').pop());
}

export class CodexSession {
  constructor(store, sessionId) {
    this.store = store;
    this.sessionId = sessionId;
    this.id = `codex:${sessionId}`;
    store.ensure(this.id, { source: 'codex', sessionId, name: 'Codex' });
  }

  set(activity, detail, ts) {
    this.store.setActivity(this.id, activity, detail, ts);
  }

  handle(rec) {
    if (!rec || typeof rec !== 'object') return;
    const ts = Date.parse(rec.timestamp) || Date.now();
    const type = rec.type;
    const p = rec.payload ?? rec;

    if (type === 'session_meta' || (p.id && p.cwd && p.originator)) {
      return this.store.ensure(this.id, { cwd: p.cwd, project: p.cwd?.split(/[\\/]/).filter(Boolean).pop(), model: p.model, branch: p.git?.branch });
    }
    if (type === 'turn_context') {
      return this.store.ensure(this.id, { cwd: p.cwd, project: p.cwd?.split(/[\\/]/).filter(Boolean).pop(), model: p.model });
    }
    if (type === 'event_msg') return this.handleEvent(p, ts);
    return this.handleItem(p, ts);
  }

  handleItem(p, ts) {
    switch (p.type) {
      case 'reasoning': {
        const summary = (p.summary || []).map((s) => s.text).join(' ');
        return this.set('thinking', summary ? `Thinking: ${short(summary, 100)}` : 'Thinking…', ts);
      }
      case 'message': {
        const text = (p.content || []).map((c) => c.text || '').join(' ');
        if (p.role === 'assistant') return this.set('talking', `Writing: ${short(text, 100)}`, ts);
        if (p.role === 'user' && text.trim() && !text.trim().startsWith('<')) {
          if (!this.store.get(this.id).title) this.store.ensure(this.id, { title: short(text, 80) });
          return this.set('thinking', `New request: ${short(text, 100)}`, ts);
        }
        return;
      }
      case 'function_call':
      case 'custom_tool_call':
      case 'local_shell_call': {
        const name = p.name || 'shell';
        const args = parseArgs(p.arguments ?? p.input ?? p.action);
        if (name === 'apply_patch' || typeof p.input === 'string' && p.input.includes('*** Begin Patch')) {
          const files = patchFiles(p.input || args.input || args.raw);
          return this.set('editing', files.length ? `Editing ${files.join(', ')}` : 'Applying a patch', ts);
        }
        if (['shell', 'exec_command', 'container.exec', 'local_shell', 'shell_command'].includes(name) || p.type === 'local_shell_call') {
          const c = classifyCommand(args.command ?? args.cmd ?? args.action?.command ?? '');
          if (c.activity === 'editing') {
            const files = patchFiles(JSON.stringify(args));
            if (files.length) c.detail = `Editing ${files.join(', ')}`;
          }
          return this.set(c.activity, c.detail, ts);
        }
        if (name === 'update_plan') return this.set('thinking', 'Updating the plan', ts);
        if (name === 'view_image') return this.set('reading', 'Looking at an image', ts);
        if (name.includes('__') || name.includes('.')) {
          const [server, ...tool] = name.replace(/^mcp__/, '').split(/__|\./);
          return this.set('mcp', `${server} › ${tool.join('.') || 'call'}`, ts);
        }
        return this.set('running', `Using ${name}`, ts);
      }
      case 'web_search_call':
        return this.set('searching', `Web search: ${short(p.action?.query || '', 60)}`, ts);
      case 'function_call_output':
      case 'custom_tool_call_output':
        return this.set('thinking', 'Looking at the results', ts);
    }
  }

  handleEvent(p, ts) {
    switch (p.type) {
      case 'task_started':
        return this.set('thinking', 'Starting a task', ts);
      case 'task_complete':
      case 'turn_aborted':
        return this.set('waiting', p.type === 'turn_aborted' ? 'Interrupted by you' : 'Done. Waiting for you', ts);
      case 'mcp_tool_call_begin': {
        const inv = p.invocation || {};
        return this.set('mcp', `${inv.server || 'mcp'} › ${inv.tool || 'call'}`, ts);
      }
      case 'exec_command_begin': {
        const c = classifyCommand(p.command || '');
        return this.set(c.activity, c.detail, ts);
      }
      case 'patch_apply_begin': {
        const files = Object.keys(p.changes || {}).map((f) => f.split('/').pop());
        return this.set('editing', files.length ? `Editing ${files.join(', ')}` : 'Applying a patch', ts);
      }
      case 'web_search_begin':
        return this.set('searching', 'Searching the web', ts);
    }
  }
}
