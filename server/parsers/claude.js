import { classifyTool, short } from '../activity.js';

// Claude Code writes one JSONL file per session:
//   ~/.claude/projects/<project-dir>/<sessionId>.jsonl
// and, for subagents in newer versions, one file per subagent:
//   ~/.claude/projects/<project-dir>/<sessionId>/subagents/<agent>.jsonl
// Older versions inline subagent messages in the main file with isSidechain: true.
export function claudeFileInfo(path) {
  const parts = path.split(/[\\/]/);
  const file = parts[parts.length - 1].replace(/\.jsonl$/, '');
  const i = parts.lastIndexOf('subagents');
  if (i >= 1 && i === parts.length - 2) {
    return { sessionId: parts[i - 1], subFile: file };
  }
  return { sessionId: file, subFile: null };
}

const TALK_DWELL_MS = 4000;

export class ClaudeSession {
  constructor(store, sessionId) {
    this.store = store;
    this.sessionId = sessionId;
    this.id = `claude-code:${sessionId}`;
    this.toolNames = new Map();     // tool_use id -> tool name
    this.subByTool = new Map();     // Task tool_use id -> subagent id
    this.unlinked = [];             // spawned subagents with no log file yet
    this.subByFile = new Map();     // subagent file -> subagent id
    this.talkTimer = null;
    store.ensure(this.id, { source: 'claude-code', sessionId, name: 'Claude' });
  }

  handle(rec, subFile = null) {
    if (!rec || typeof rec !== 'object') return;
    const ts = Date.parse(rec.timestamp) || Date.now();

    if (rec.type === 'ai-title' && rec.aiTitle) return this.store.ensure(this.id, { title: short(rec.aiTitle, 80) });
    if (rec.type === 'summary' && rec.summary) return this.store.ensure(this.id, { title: short(rec.summary, 80) });
    if (rec.cwd && !subFile && !rec.isSidechain) {
      this.store.ensure(this.id, { cwd: rec.cwd, project: rec.cwd.split(/[\\/]/).filter(Boolean).pop(), branch: rec.gitBranch });
    }

    if (subFile || rec.isSidechain) return this.handleSub(subFile || `sidechain:${rec.agentId || ''}`, rec, ts);
    if (rec.type === 'assistant') return this.handleAssistant(this.id, rec, ts, true);
    if (rec.type === 'user') return this.handleUser(rec, ts);
  }

  handleAssistant(agentId, rec, ts, isMain) {
    const msg = rec.message || {};
    if (msg.model && isMain) this.store.ensure(this.id, { model: msg.model });
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const item of content) {
      if (item.type === 'thinking' || item.type === 'redacted_thinking') {
        this.store.setActivity(agentId, 'thinking', item.thinking ? `Thinking: ${short(item.thinking, 100)}` : 'Thinking…', ts);
      } else if (item.type === 'text' && item.text?.trim()) {
        this.store.setActivity(agentId, 'talking', `Writing: ${short(item.text, 100)}`, ts);
      } else if (item.type === 'tool_use') {
        this.toolNames.set(item.id, item.name);
        const c = classifyTool(item.name, item.input || {});
        if (isMain && c.activity === 'subagent') {
          const subId = `${this.id}:sub:${item.id}`;
          const input = item.input || {};
          this.store.spawn(this.id, subId, {
            name: input.subagent_type || 'subagent',
            title: short(input.description, 80),
            detail: short(input.description || input.prompt, 100),
          }, ts);
          this.subByTool.set(item.id, subId);
          this.unlinked.push(subId);
          this.delegating(ts);
        } else {
          this.store.setActivity(agentId, c.activity, c.detail, ts, { tool: c.tool });
        }
      }
    }
    if (isMain && msg.stop_reason === 'end_turn') this.endTurn(ts);
  }

  handleUser(rec, ts) {
    const content = rec.message?.content;
    if (typeof content === 'string') return this.prompt(content, ts);
    if (!Array.isArray(content)) return;
    let sawResult = false;
    for (const item of content) {
      if (item.type === 'tool_result') {
        sawResult = true;
        const subId = this.subByTool.get(item.tool_use_id);
        if (subId) {
          this.subByTool.delete(item.tool_use_id);
          this.unlinked = this.unlinked.filter((s) => s !== subId);
          for (const [f, s] of this.subByFile) if (s === subId) this.subByFile.delete(f);
          this.store.finish(subId, ts);
        }
      } else if (item.type === 'text') {
        this.prompt(item.text, ts);
      }
    }
    if (sawResult) {
      if (this.store.activeSubagents(this.id).length) this.delegating(ts);
      else this.store.setActivity(this.id, 'thinking', 'Looking at the results', ts);
    }
  }

  prompt(text, ts) {
    const t = String(text || '');
    if (/^\[Request interrupted/.test(t)) return this.store.setActivity(this.id, 'waiting', 'Interrupted by you', ts);
    if (t.startsWith('<') || !t.trim()) return; // command echoes, reminders, local output
    this.store.setActivity(this.id, 'thinking', `New request: ${short(t, 100)}`, ts);
  }

  delegating(ts) {
    const n = this.store.activeSubagents(this.id).length;
    this.store.setActivity(this.id, 'subagent', `Coordinating ${n} subagent${n === 1 ? '' : 's'}`, ts);
  }

  // Leave the reply on screen for a moment, then walk to the lounge.
  endTurn(ts) {
    clearTimeout(this.talkTimer);
    const a = this.store.get(this.id);
    const delay = Date.now() - ts > TALK_DWELL_MS ? 0 : TALK_DWELL_MS;
    const mark = a?.lastEventAt;
    const go = () => {
      const cur = this.store.get(this.id);
      if (cur && cur.lastEventAt === mark && cur.subagents.length === 0) {
        this.store.setActivity(this.id, 'waiting', 'Done. Waiting for you', ts);
      }
    };
    if (delay) this.talkTimer = setTimeout(go, delay).unref?.() ?? null;
    else go();
  }

  handleSub(fileKey, rec, ts) {
    let subId = this.subByFile.get(fileKey);
    if (!subId || !this.store.get(subId)) {
      subId = this.unlinked.shift();
      if (!subId) {
        // Subagent whose Task call we never saw (e.g. file read from the middle).
        if (rec.type !== 'assistant') return;
        subId = `${this.id}:sub:${fileKey}`;
        this.store.spawn(this.id, subId, { name: rec.agentType || 'subagent', detail: 'Working' }, ts);
      }
      this.subByFile.set(fileKey, subId);
    }
    if (rec.type === 'assistant') this.handleAssistant(subId, rec, ts, false);
    else if (rec.type === 'user' && Array.isArray(rec.message?.content) && rec.message.content.some((c) => c.type === 'tool_result')) {
      this.store.setActivity(subId, 'thinking', 'Looking at the results', ts);
    }
  }
}
