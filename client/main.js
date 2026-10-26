import { Office, ACTIVITY_LABEL, WORLD_W, WORLD_H } from './office.js';
import { ZONES } from './office-map.js';

const $ = (sel) => document.querySelector(sel);
const SPRITES = 'assets/sprites/';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn(`could not load ${src}`); resolve(null); };
    img.src = src;
  });
}

async function loadSprites() {
  const manifest = await (await fetch(SPRITES + 'manifest.json')).json();
  const props = Object.entries(manifest.props);
  const textures = Object.entries(manifest.textures || {});
  const [fx, chars, propImgs, texImgs] = await Promise.all([
    loadImage(SPRITES + manifest.fx.file),
    Promise.all(manifest.character.list.map((c) => loadImage(SPRITES + c.file))),
    Promise.all(props.map(([, p]) => loadImage(SPRITES + p.file))),
    Promise.all(textures.map(([, t]) => loadImage(SPRITES + t.file))),
    document.fonts?.load('700 12px "Pretendard Variable"').catch(() => {}),
  ]);
  return {
    manifest, fx, chars,
    props: Object.fromEntries(props.map(([name], i) => [name, propImgs[i]])),
    textures: Object.fromEntries(textures.map(([name], i) => [name, texImgs[i]])),
  };
}

const sprites = await loadSprites();
const canvas = $('#office');
const stage = $('#stage');
const minimap = $('#minimap');
const office = new Office(canvas, sprites);
let agents = [];
let clockSkew = 0;

function fitCanvas() {
  const r = stage.getBoundingClientRect();
  office.resize(r.width, r.height, window.devicePixelRatio || 1);
}
new ResizeObserver(fitCanvas).observe(stage);
fitCanvas();

// Render loop
let last = performance.now();
let tick = 0;
function frame(now) {
  office.step(Math.min(0.05, (now - last) / 1000));
  last = now;
  office.render();
  if (tick++ % 3 === 0) office.renderMinimap(minimap);
  $('#zoom-level').textContent = `${Math.round(office.cam.zoom * 100)}%`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Live state from the server. The local server streams server-sent events; the
// shared office on Cloudflare uses a WebSocket that needs the team key first.
const mode = await fetch('api/mode').then((r) => (r.ok ? r.json() : {})).then((m) => m.mode || 'local', () => 'local');
const cloud = mode === 'cloud';
office.showOwner = cloud;
document.body.classList.toggle('cloud', cloud);

function online(on, label) {
  $('#conn').classList.toggle('off', !on);
  $('#conn-label').textContent = label;
}

function apply(state) {
  agents = state.agents;
  clockSkew = Date.now() - state.now;
  office.update(agents);
  renderRoster();
  renderDetail();
  $('#empty').hidden = agents.length > 0;
}

function connectLocal() {
  const es = new EventSource('api/events');
  es.onopen = () => online(true, 'Live');
  es.onerror = () => online(false, 'Reconnecting…');
  es.onmessage = (e) => apply(JSON.parse(e.data));
}

const KEY_ITEM = 'agent-town-key';
const storedKey = () => { try { return localStorage.getItem(KEY_ITEM) || ''; } catch { return ''; } };
const storeKey = (k) => { try { k ? localStorage.setItem(KEY_ITEM, k) : localStorage.removeItem(KEY_ITEM); } catch {} };

function askKey(wrong) {
  return new Promise((resolve) => {
    const d = $('#key-dialog');
    $('#key-note').textContent = wrong ? 'That key did not work. Check it with your team.' : '';
    $('#team-key').value = '';
    d.onclose = () => resolve($('#team-key').value.trim());
    d.showModal();
  });
}

async function connectCloud(wrong = false) {
  let key = wrong ? '' : storedKey();
  if (!key) {
    online(false, 'Team key needed');
    key = await askKey(wrong);
    if (!key) return connectCloud();
  }
  const ws = new WebSocket(new URL('api/live', location.href.replace(/^http/, 'ws')));
  let ping;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', key }));
    ping = setInterval(() => ws.send('ping'), 30_000);
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    storeKey(key);
    online(true, 'Live');
    apply(JSON.parse(e.data));
  };
  ws.onclose = (e) => {
    clearInterval(ping);
    if (e.code === 4001) { storeKey(''); return connectCloud(true); }
    online(false, 'Reconnecting…');
    setTimeout(() => connectCloud(), 2000);
  };
}

if (cloud) {
  $('#open-settings').hidden = true;
  $('#empty h2').textContent = 'Nobody is sharing right now';
  $('#empty p').innerHTML = 'Run <code>npm run client</code> on your computer, set your name, this office\'s URL and the team key, and your agents walk in.';
  connectCloud();
} else {
  connectLocal();
}
setInterval(() => { renderRoster(); renderDetail(); }, 1000);

// ---- Moving around the office ------------------------------------------------

function local(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

let drag = null;
const pointers = new Map(); // for pinch zoom on touch screens
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  drag = { ...local(e), moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const p = local(e);
  if (pointers.size === 2 && pointers.has(e.pointerId)) {
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    pointers.set(e.pointerId, p);
    const [c, d] = [...pointers.values()];
    const after = Math.hypot(c.x - d.x, c.y - d.y);
    if (before > 0) office.zoomAt(after / before, (c.x + d.x) / 2, (c.y + d.y) / 2);
    if (drag) drag.moved = true;
    return;
  }
  if (drag && (drag.moved || Math.hypot(p.x - drag.x, p.y - drag.y) > 4)) {
    office.panBy(drag.x - p.x, drag.y - p.y);
    drag = { ...p, moved: true };
    canvas.classList.add('dragging');
    $('#tooltip').hidden = true;
    return;
  }
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  hover(e, p);
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (drag && !drag.moved && e.type === 'pointerup') {
    const w = office.toWorld(...Object.values(local(e)));
    const c = office.hit(w.x, w.y);
    select(c?.id || null, false);
  }
  if (!pointers.size) drag = null;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { office.hover = null; $('#tooltip').hidden = true; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = local(e);
  const scale = e.deltaMode === 1 ? 16 : 1; // lines -> pixels
  if (e.ctrlKey || e.metaKey) office.zoomAt(Math.exp(-e.deltaY * scale * 0.01), p.x, p.y);
  else office.panBy(e.deltaX * scale, e.deltaY * scale);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  const step = 80;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step], a: [-step, 0], d: [step, 0], w: [0, -step], s: [0, step] };
  if (moves[e.key]) { office.panBy(...moves[e.key]); e.preventDefault(); }
  else if (e.key === '+' || e.key === '=') office.zoomAt(1.2);
  else if (e.key === '-') office.zoomAt(1 / 1.2);
  else if (e.key === '0') office.fit();
  else if (e.key === 'Escape') select(null);
});

$('#zoom-in').onclick = () => office.zoomAt(1.25);
$('#zoom-out').onclick = () => office.zoomAt(1 / 1.25);
$('#zoom-fit').onclick = () => office.fit();

// Click or drag on the minimap to jump there.
function jump(e) {
  const r = minimap.getBoundingClientRect();
  office.following = null;
  office.centerOn(((e.clientX - r.left) / r.width) * WORLD_W, ((e.clientY - r.top) / r.height) * WORLD_H, e.type === 'pointerdown');
}
minimap.addEventListener('pointerdown', (e) => { minimap.setPointerCapture(e.pointerId); jump(e); });
minimap.addEventListener('pointermove', (e) => { if (e.buttons) jump(e); });

function hover(e, p) {
  const w = office.toWorld(p.x, p.y);
  const c = office.hit(w.x, w.y);
  office.hover = c?.id || null;
  canvas.classList.toggle('hovering', !!c);
  const tip = $('#tooltip');
  if (!c) { tip.hidden = true; return; }
  const a = c.agent;
  tip.innerHTML = `<b>${esc(a.name)}${a.project ? ' · ' + esc(a.project) : ''}</b><span class="act ${a.activity}">${esc(ACTIVITY_LABEL[a.activity] || a.activity)}</span>${esc(a.detail)}`;
  tip.style.left = `${Math.min(p.x + 16, stage.clientWidth - 300)}px`;
  tip.style.top = `${p.y + 16}px`;
  tip.hidden = false;
}

function select(id, follow = true) {
  office.selected = id;
  if (id && follow) office.follow(id);
  else if (!id) office.following = null;
  renderRoster();
  renderDetail();
}

// ---- Side panel ---------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - clockSkew - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function sourceBadge(a) {
  return `<span class="badge ${a.source === 'codex' ? 'codex' : ''}">${a.source === 'codex' ? 'Codex' : 'Claude Code'}</span>`;
}

const avatars = new Map(); // sprite index -> data URL
function avatar(a, cls = '') {
  const c = office.chars.get(a.id);
  if (!c) return `<span class="avatar ${cls}"></span>`;
  if (!avatars.has(c.sprite)) {
    const m = sprites.manifest.character;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 72;
    const ctx = cv.getContext('2d');
    // Head and shoulders of the idle frame.
    ctx.drawImage(sprites.chars[c.sprite], 20, m.rows.indexOf('idle_down') * m.frame + 2, 88, 88, 0, 0, 72, 72);
    avatars.set(c.sprite, cv.toDataURL());
  }
  return `<img class="avatar ${cls}" src="${avatars.get(c.sprite)}" alt="">`;
}

function renderRoster() {
  // Busy agents first, then the ones waiting on you, then idle; newest first within each.
  const rank = (a) => (a.activity === 'idle' ? 2 : a.activity === 'waiting' ? 1 : 0);
  const mains = agents.filter((a) => a.kind !== 'subagent').sort((a, b) => rank(a) - rank(b) || b.lastEventAt - a.lastEventAt);
  $('#count').textContent = mains.length ? mains.length : '';
  // In a shared office, each person's agents sit under that person's name.
  const people = new Map();
  for (const a of mains) {
    if (!people.has(a.userId)) people.set(a.userId, { name: a.userName, agents: [] });
    people.get(a.userId).agents.push(a);
  }
  const grouped = cloud || people.size > 1;
  const items = [];
  for (const p of [...people.values()].sort((x, y) => x.name.localeCompare(y.name))) {
    if (grouped) items.push(`<li class="person"><span>${esc(p.name)}</span><span class="n">${p.agents.length}</span></li>`);
    for (const a of p.agents) {
      items.push(rosterItem(a, false));
      for (const s of agents.filter((x) => x.parentId === a.id)) items.push(rosterItem(s, true));
    }
  }
  $('#roster').innerHTML = items.join('') || '<li class="empty">Nobody is here yet.</li>';
  for (const li of $('#roster').querySelectorAll('li[data-id]')) li.onclick = () => select(li.dataset.id);
}

function rosterItem(a, sub) {
  return `<li data-id="${esc(a.id)}" class="${sub ? 'sub' : ''} ${office.selected === a.id ? 'sel' : ''}">
    ${avatar(a)}
    <span class="who"><span class="name">${sub ? '↳ ' : ''}${esc(a.name)}${!sub && a.project ? ` <span class="proj">· ${esc(a.project)}</span>` : ''}</span>
      <span class="title">${esc(!sub && a.title ? a.title : a.detail)}</span></span>
    <span class="act ${a.activity}">${esc(ACTIVITY_LABEL[a.activity] || a.activity)}${a.activity === 'waiting' || a.activity === 'idle' ? ` · ${ago(a.since)}` : ''}</span></li>`;
}

function renderDetail() {
  const el = $('#detail');
  const a = agents.find((x) => x.id === office.selected);
  if (!a) { el.hidden = true; return; }
  el.hidden = false;
  const parent = a.parentId && agents.find((x) => x.id === a.parentId);
  const subs = agents.filter((x) => x.parentId === a.id);
  el.innerHTML = `
    <div class="top">${avatar(a, 'big')}<div class="id"><h2>${esc(a.name)}</h2><div>${sourceBadge(a)} ${a.kind === 'subagent' ? '<span class="muted small">subagent</span>' : ''}</div></div>
      <button class="close" title="Close (Esc)">×</button></div>
    ${a.title ? `<div class="task">${esc(a.title)}</div>` : ''}
    <div class="now"><div class="label">Right now · for ${ago(a.since)}</div>
      <div class="what act ${a.activity}">${esc(ACTIVITY_LABEL[a.activity] || a.activity)}</div>
      <div class="why">${esc(a.detail)}</div></div>
    <dl>
      ${cloud ? `<dt>Person</dt><dd>${esc(a.userName)}</dd>` : ''}
      ${a.project ? `<dt>Project</dt><dd>${esc(a.project)}</dd>` : ''}
      ${a.branch ? `<dt>Branch</dt><dd>${esc(a.branch)}</dd>` : ''}
      ${a.model ? `<dt>Model</dt><dd>${esc(a.model)}</dd>` : ''}
      ${parent ? `<dt>Working for</dt><dd>${esc(parent.name)} · ${esc(parent.project)}</dd>` : ''}
      ${subs.length ? `<dt>Subagents</dt><dd>${subs.map((s) => esc(s.name)).join(', ')}</dd>` : ''}
      ${a.cwd ? `<dt>Folder</dt><dd>${esc(a.cwd)}</dd>` : ''}
      <dt>Session</dt><dd>${esc(a.sessionId.slice(0, 8))}</dd>
      <dt>Last seen</dt><dd>${ago(a.lastEventAt)} ago</dd>
    </dl>
    <h3>Recent</h3>
    <ol>${a.history.map((h) => `<li><span class="t">${ago(h.t)}</span><span>${esc(h.detail)}</span></li>`).join('')}</ol>`;
  el.querySelector('.close').onclick = () => select(null);
}

$('#legend').innerHTML = ZONES.filter((z) => z.activities.length)
  .map((z) => `<li><b>${esc(z.label)}</b><span>${z.activities.map((x) => esc(ACTIVITY_LABEL[x])).join(', ')}</span></li>`).join('');

// ---- Settings: which agents to watch -------------------------------------------

const dialog = $('#settings');
$('#open-settings').onclick = async () => {
  const { config, types, demo, file } = await (await fetch('api/config')).json();
  $('#agent-list').innerHTML = config.agents.map((a, i) => `
    <div class="agent-row" data-i="${i}" data-type="${esc(a.type)}">
      <input type="checkbox" ${a.enabled ? 'checked' : ''} id="ag-${i}">
      <label for="ag-${i}"><b>${esc(types[a.type] || a.type)}</b></label>
      <input class="path" type="text" value="${esc(a.path)}" spellcheck="false">
    </div>`).join('');
  $('#user-name').value = config.user.name;
  $('#settings-note').textContent = demo ? 'Demo mode is on: the office shows simulated agents, but your changes are still saved.' : `Saved to ${file}`;
  dialog.showModal();
};
$('#save-settings').onclick = async (e) => {
  e.preventDefault();
  const rows = [...document.querySelectorAll('.agent-row')];
  const body = {
    agents: rows.map((r) => ({ type: r.dataset.type, enabled: r.querySelector('input[type=checkbox]').checked, path: r.querySelector('.path').value.trim() })),
    user: { name: $('#user-name').value.trim() || undefined },
  };
  const res = await fetch('api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) dialog.close();
  else $('#settings-note').textContent = (await res.json()).error;
};
