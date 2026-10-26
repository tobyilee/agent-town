const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ago(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

const REASON = { session: 'blocked', folder: 'in a blocked folder', 'no-folder-yet': 'held back until its folder is known' };

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(reply.error || `failed (${res.status})`);
  return reply;
}

let state = null;
let formFilled = false;

function fillForm(cfg) {
  $('#name').value = cfg.user.name;
  $('#server').value = cfg.server;
  $('#key').value = '';
  $('#key').placeholder = cfg.keySet ? '•••••• saved (type to replace)' : 'Ask your team for the key';
  $('#clear-key').hidden = !cfg.keySet;
  formFilled = true;
}

function renderStatus() {
  const { status, config, sessions } = state;
  const shared = sessions.filter((s) => s.shared).length;
  const dot = $('#dot');
  dot.className = `dot ${status.state === 'ok' ? '' : status.state === 'off' ? 'idle' : 'off'}`;
  $('#status').textContent = status.state === 'ok'
    ? `Sharing ${shared} of ${sessions.length} as ${config.user.name} · ${status.users ?? '?'} in the office`
    : status.state === 'off' ? status.error : `Not syncing: ${status.error}`;
}

function renderSessions() {
  const { sessions, now } = state;
  $('#count').textContent = sessions.length ? `${sessions.filter((s) => s.shared).length} shared / ${sessions.length}` : '';
  $('#sessions').innerHTML = sessions.map((s) => `
    <li class="${s.shared ? '' : 'blocked'}">
      <span class="who">
        <span class="name"><span class="badge ${s.source === 'codex' ? 'codex' : ''}">${s.source === 'codex' ? 'Codex' : 'Claude'}</span>${esc(s.project || s.name)}</span>
        <span class="title">${esc(s.title || s.activity)} · ${ago(s.lastEventAt, now)} ago${s.subagents ? ` · ${s.subagents} subagent${s.subagents > 1 ? 's' : ''}` : ''}</span>
        <span class="cwd">${esc(s.cwd || 'folder not known yet')} · ${esc(s.sessionId.slice(0, 8))}</span>
      </span>
      <span class="side">
        ${s.reason && s.reason !== 'session' ? `<span class="why">${esc(REASON[s.reason])}</span>` : ''}
        ${s.cwd && s.reason !== 'folder' ? `<button class="btn ghost small" data-folder="${esc(s.cwd)}" title="Block every session in this folder">Block folder</button>` : ''}
        <button class="toggle ${s.reason === 'session' ? 'off' : ''}" data-session="${esc(s.sessionId)}" data-blocked="${s.reason === 'session'}">${s.reason === 'session' ? 'Blocked' : 'Share'}</button>
      </span>
    </li>`).join('') || '<li class="empty">No Claude Code or Codex session has written a log lately.</li>';
}

function renderFolders() {
  const folders = state.config.blockedFolders;
  $('#folders').innerHTML = folders.map((f, i) => `<li><span>${esc(f)}</span><button class="btn ghost small" data-i="${i}">Unblock</button></li>`).join('')
    || '<li class="empty">No folders are blocked.</li>';
}

async function refresh() {
  try {
    state = await (await fetch('api/state')).json();
  } catch {
    $('#dot').className = 'dot off';
    $('#status').textContent = 'agent-town-client is not running';
    return;
  }
  if (!formFilled) fillForm(state.config);
  renderStatus();
  renderSessions();
  renderFolders();
  $('#file').textContent = `${state.demo ? 'Demo mode: these are simulated sessions. ' : ''}Settings are saved on this computer only.`;
}

async function saveFolders(blockedFolders) {
  try {
    await post('api/config', { blockedFolders });
  } catch (e) {
    alert(e.message);
  }
  refresh();
}

$('#you').onsubmit = async (e) => {
  e.preventDefault();
  const note = $('#you-note');
  try {
    const { config } = await post('api/config', { user: { name: $('#name').value }, server: $('#server').value, key: $('#key').value });
    fillForm(config);
    note.textContent = 'Saved.';
  } catch (err) {
    note.textContent = err.message;
  }
  refresh();
};

$('#clear-key').onclick = async () => {
  const { config } = await post('api/config', { clearKey: true });
  fillForm(config);
  refresh();
};

$('#sessions').onclick = async (e) => {
  const toggle = e.target.closest('[data-session]');
  const folder = e.target.closest('[data-folder]');
  if (toggle) {
    await post('api/block', { sessionId: toggle.dataset.session, blocked: toggle.dataset.blocked !== 'true' });
    refresh();
  } else if (folder) {
    saveFolders([...state.config.blockedFolders, folder.dataset.folder]);
  }
};

$('#folders').onclick = (e) => {
  const b = e.target.closest('[data-i]');
  if (b) saveFolders(state.config.blockedFolders.filter((_, i) => i !== Number(b.dataset.i)));
};

$('#add-folder').onsubmit = (e) => {
  e.preventDefault();
  const f = $('#folder').value.trim();
  if (!f) return;
  $('#folder').value = '';
  saveFolders([...state.config.blockedFolders, f]);
};

refresh();
setInterval(refresh, 2000);
