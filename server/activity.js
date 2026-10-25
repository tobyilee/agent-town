// Activity vocabulary shared by all parsers. The client maps each activity to an
// office zone (client/office-map.js) and an effect icon.
export const ACTIVITIES = [
  'thinking',  // model is reasoning / planning
  'talking',   // writing a reply to the user
  'reading',   // reading files
  'editing',   // writing or editing files
  'searching', // grep / glob / web search
  'running',   // shell commands
  'mcp',       // calling an MCP server tool
  'subagent',  // delegating to subagents
  'waiting',   // turn finished, waiting for the user
  'idle',      // no activity for a while
];

export function short(text, max = 120) {
  if (text == null) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function base(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(p);
}

// Classifies a Claude Code-style tool call (name + input object).
export function classifyTool(name, input = {}) {
  const n = String(name || '');
  if (n.startsWith('mcp__')) {
    const [, server, ...rest] = n.split('__');
    return { activity: 'mcp', detail: `${server} › ${rest.join('__') || 'call'}`, tool: n };
  }
  switch (n) {
    case 'Read':
    case 'NotebookRead':
      return { activity: 'reading', detail: `Reading ${base(input.file_path || input.notebook_path)}`, tool: n, file: input.file_path };
    case 'Write':
      return { activity: 'editing', detail: `Writing ${base(input.file_path)}`, tool: n, file: input.file_path };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { activity: 'editing', detail: `Editing ${base(input.file_path || input.notebook_path)}`, tool: n, file: input.file_path || input.notebook_path };
    case 'Grep':
      return { activity: 'searching', detail: `Searching for "${short(input.pattern, 40)}"`, tool: n };
    case 'Glob':
    case 'LS':
      return { activity: 'searching', detail: `Looking for ${short(input.pattern || input.path, 50)}`, tool: n };
    case 'WebSearch':
      return { activity: 'searching', detail: `Web search: ${short(input.query, 60)}`, tool: n };
    case 'WebFetch':
      return { activity: 'reading', detail: `Fetching ${short(input.url, 60)}`, tool: n };
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return classifyCommand(input.command || input.description || n);
    case 'Task':
    case 'Agent':
      return { activity: 'subagent', detail: `Delegating: ${short(input.description || input.prompt, 60)}`, tool: n };
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'ExitPlanMode':
      return { activity: 'thinking', detail: 'Planning next steps', tool: n };
    default:
      return { activity: 'running', detail: `Using ${n}`, tool: n };
  }
}

// Classifies a shell command line by what it most likely does.
export function classifyCommand(cmd) {
  const c = short(Array.isArray(cmd) ? cmd.join(' ') : cmd, 200);
  // Unwrap `bash -lc "..."` style wrappers.
  const inner = c.replace(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+/, '').replace(/^['"]|['"]$/g, '');
  const first = inner.split(/\s+/)[0] || '';
  if (/^(apply_patch)$/.test(first) || /\*\*\* (Update|Add) File:/.test(inner)) {
    return { activity: 'editing', detail: 'Applying a patch', tool: 'shell' };
  }
  if (/^(rg|grep|ag|find|fd|ls|tree)$/.test(first)) {
    return { activity: 'searching', detail: `$ ${short(inner, 70)}`, tool: 'shell' };
  }
  if (/^(cat|head|tail|less|sed|nl|bat|wc)$/.test(first) && !/\s-i\b/.test(inner)) {
    return { activity: 'reading', detail: `$ ${short(inner, 70)}`, tool: 'shell' };
  }
  return { activity: 'running', detail: `$ ${short(inner, 70)}`, tool: 'shell' };
}
