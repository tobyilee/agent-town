import { Office, ACTIVITY_LABEL, SCALE } from './office.js';
import { ZONES } from './office-map.js';

const $ = (sel) => document.querySelector(sel);
const SPRITES = 'assets/sprites/';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

async function loadSprites() {
  const m = await (await fetch(SPRITES + 'manifest.json')).json();
  const [office, fx, ...chars] = await Promise.all([
    loadImage(SPRITES + m.office.file),
    loadImage(SPRITES + m.fx.file),
    ...m.characters.map((c) => loadImage(SPRITES + c.file)),
  ]);
  return { frame: m.frame, rows: m.characterRows, characters: m.characters, chars, office, fx, fxRows: m.fx.rows };
}

const sprites = await loadSprites();
const canvas = $('#office');
const office = new Office(canvas, sprites);
let agents = [];
let serverNow = Date.now();
let clockSkew = 0;

// Render loop
let last = performance.now();
function frame(now) {
  office.step(Math.min(0.05, (now - last) / 1000));
  last = now;
  office.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Live state from the server
function connect() {
  const es = new EventSource('api/events');
  es.onopen = () => { $('#conn').classList.remove('off'); $('#conn-label').textContent = 'live'; };
  es.onerror = () => { $('#conn').classList.add('off'); $('#conn-label').textContent = 'reconnecting…'; };
  es.onmessage = (e) => {
    const state = JSON.parse(e.data);
    agents = state.agents;
    serverNow = state.now;
    clockSkew = Date.now() - serverNow;
    office.update(agents);
    renderRoster();
    renderDetail();
    $('#empty').hidden = agents.length > 0;
  };
}
connect();
setInterval(renderDetail, 1000);

// Pointer interaction
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * (canvas.width / SCALE), y: ((e.clientY - r.top) / r.height) * (canvas.height / SCALE) };
}
canvas.addEventListener('mousemove', (e) => {
  const p = toCanvas(e);
  const c = office.hit(p.x, p.y);
  office.hover = c?.id || null;
  canvas.classList.toggle('hovering', !!c);
  const tip = $('#tooltip');
  if (!c) { tip.hidden = true; return; }
  const a = c.agent;
  tip.innerHTML = `<b>${esc(a.name)}${a.project ? ' · ' + esc(a.project) : ''}</b>${esc(ACTIVITY_LABEL[a.activity] || a.activity)}: ${esc(a.detail)}`;
  const sr = $('#stage').getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX - sr.left + 14, sr.width - 290)}px`;
  tip.style.top = `${e.clientY - sr.top + 14}px`;
  tip.hidden = false;
});
canvas.addEventListener('mouseleave', () => { office.hover = null; $('#tooltip').hidden = true; });
canvas.addEventListener('click', (e) => {
  const p = toCanvas(e);
  select(office.hit(p.x, p.y)?.id || null);
});

function select(id) {
  office.selected = id;
  renderRoster();
  renderDetail();
}

// Side panel
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

function renderRoster() {
  const mains = agents.filter((a) => a.kind !== 'subagent');
  $('#count').textContent = mains.length ? `(${mains.length})` : '';
  const items = [];
  for (const a of mains) {
    items.push(rosterItem(a, false));
    for (const s of agents.filter((x) => x.parentId === a.id)) items.push(rosterItem(s, true));
  }
  $('#roster').innerHTML = items.join('') || '<li class="empty">Nobody is here yet.</li>';
  for (const li of $('#roster').querySelectorAll('li[data-id]')) li.onclick = () => select(li.dataset.id);
}

function rosterItem(a, sub) {
  return `<li data-id="${esc(a.id)}" class="${sub ? 'sub' : ''} ${office.selected === a.id ? 'sel' : ''}">
    <span class="name">${sub ? '↳ ' : ''}${esc(a.name)}${!sub && a.project ? ` · ${esc(a.project)}` : ''}</span>
    <span class="act">${esc(ACTIVITY_LABEL[a.activity] || a.activity)}</span></li>`;
}

function avatar(a) {
  const c = office.chars.get(a.id);
  if (!c) return '';
  const cv = document.createElement('canvas');
  cv.width = cv.height = sprites.frame;
  const ctx = cv.getContext('2d');
  ctx.drawImage(sprites.chars[c.sprite], 0, sprites.rows.indexOf('idle_down') * sprites.frame, sprites.frame, sprites.frame, 0, 0, sprites.frame, sprites.frame);
  return `<img src="${cv.toDataURL()}" alt="">`;
}

function renderDetail() {
  const el = $('#detail');
  const a = agents.find((x) => x.id === office.selected);
  if (!a) { el.hidden = true; return; }
  el.hidden = false;
  const parent = a.parentId && agents.find((x) => x.id === a.parentId);
  const subs = agents.filter((x) => x.parentId === a.id);
  el.innerHTML = `
    <div class="top">${avatar(a)}<div><h2>${esc(a.name)}</h2>${sourceBadge(a)} ${a.kind === 'subagent' ? '<span class="muted small">subagent</span>' : ''}</div>
      <button class="close" title="Close">×</button></div>
    ${a.title ? `<div class="small muted">${esc(a.title)}</div>` : ''}
    <div class="now"><div class="label">Right now · for ${ago(a.since)}</div>
      <div class="what">${esc(ACTIVITY_LABEL[a.activity] || a.activity)}</div>
      <div class="why">${esc(a.detail)}</div></div>
    <dl>
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
    <ol>${a.history.map((h) => `<li><span class="t">${ago(h.t)} ago</span><span>${esc(h.detail)}</span></li>`).join('')}</ol>`;
  el.querySelector('.close').onclick = () => select(null);
}

$('#legend').innerHTML = ZONES.map((z) => `<li><b>${esc(z.label)}</b>${z.activities.map((x) => esc(ACTIVITY_LABEL[x])).join(', ')}</li>`).join('');

// Settings: which agents to watch
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
