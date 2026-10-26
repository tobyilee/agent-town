import { TILE, COLS, ROWS, ZONES, FURNITURE, DOOR, SEATS, FLAT, buildBlocked } from './office-map.js';
import { paintStatic } from './floor.js';

export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;
const SPEED = 150;          // world px per second
const CHAR = 64;            // character frame in world px
const FEET = 62;            // feet baseline inside the frame
const SUB_SCALE = 0.78;     // subagents are drawn smaller
// Seconds an activity must last before its character walks off. Tuned on real
// logs: 63% fewer room changes than moving at once, and far fewer trips that end
// before the character arrives. Short thinking between tool calls is the most
// common blip, so it waits longer.
const MOVE_DELAY = 1.5;
const THINK_DELAY = 3;
const MAX_ZOOM = 2.5;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Segoe UI", system-ui, sans-serif';
const ZONE_OF = Object.fromEntries(ZONES.flatMap((z) => z.activities.map((a) => [a, z])));
const WORKING = new Set(['editing', 'talking', 'reading', 'searching', 'running', 'mcp']);
const SOURCE_COLOR = { 'claude-code': '#e8875a', codex: '#2fb38c' };

export const ACTIVITY_LABEL = {
  thinking: 'Thinking', talking: 'Replying', reading: 'Reading', editing: 'Editing', searching: 'Searching',
  running: 'Running a command', mcp: 'Calling MCP', subagent: 'Delegating', waiting: 'Waiting for you', idle: 'Idle',
};

export function zoneFor(activity) {
  return ZONE_OF[activity] || ZONE_OF.idle;
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const blocked = buildBlocked();

function findPath(from, to) {
  const key = (x, y) => y * COLS + x;
  const prev = new Map([[key(...from), null]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || prev.has(key(nx, ny))) continue;
      if (blocked[ny][nx] && !(nx === to[0] && ny === to[1])) continue;
      prev.set(key(nx, ny), [x, y]);
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(key(...to))) return [to];
  const path = [];
  for (let p = to; p; p = prev.get(key(...p))) path.unshift(p);
  return path.slice(1);
}

const feet = ([tx, ty]) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 3 });
const tileOf = (x, y) => [Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE))), Math.max(0, Math.min(ROWS - 1, Math.floor((y - 1) / TILE)))];

export class Office {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    this.scale = sprites.manifest.scale;
    this.floor = paintStatic(sprites, this.scale);
    this.props = FURNITURE.filter(([type]) => !FLAT.has(type)).map(([type, x, y, w, h]) => ({ type, x, y, w, h, seat: SEATS.has(type) }));
    this.chars = new Map();
    this.spotOwner = new Map(); // "zone:index" -> agent id
    this.selected = null;
    this.hover = null;
    this.following = null;
    this.t = 0;
    this.view = { w: 1, h: 1, dpr: 1 };
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.camTarget = null;
  }

  // ---- Camera -------------------------------------------------------------

  resize(w, h, dpr) {
    const first = this.view.w === 1;
    this.view = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (first) {
      this.cam.zoom = Math.max(this.minZoom(), Math.min(1, w / (WORLD_W * 0.62)));
      this.centerOn(WORLD_W / 2, WORLD_H * 0.45, false);
    }
    this.clamp();
  }

  minZoom() {
    return Math.min(this.view.w / WORLD_W, this.view.h / WORLD_H) * 0.98;
  }

  clamp() {
    const { w, h } = this.view, z = this.cam.zoom;
    const fit = (pos, view, world) => (view / z >= world ? (world - view / z) / 2 : Math.max(0, Math.min(world - view / z, pos)));
    this.cam.x = fit(this.cam.x, w, WORLD_W);
    this.cam.y = fit(this.cam.y, h, WORLD_H);
  }

  centerOn(wx, wy, smooth = true) {
    const x = wx - this.view.w / 2 / this.cam.zoom, y = wy - this.view.h / 2 / this.cam.zoom;
    if (smooth) this.camTarget = { x, y };
    else { this.cam.x = x; this.cam.y = y; this.camTarget = null; this.clamp(); }
  }

  panBy(dx, dy) {
    this.cam.x += dx / this.cam.zoom;
    this.cam.y += dy / this.cam.zoom;
    this.camTarget = null;
    this.following = null;
    this.clamp();
  }

  zoomAt(factor, sx = this.view.w / 2, sy = this.view.h / 2) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.cam.zoom * factor));
    this.cam.x = before.x - sx / this.cam.zoom;
    this.cam.y = before.y - sy / this.cam.zoom;
    this.camTarget = null;
    this.clamp();
  }

  fit() {
    this.cam.zoom = this.minZoom();
    this.following = null;
    this.centerOn(WORLD_W / 2, WORLD_H / 2, false);
  }

  follow(id) {
    this.following = id;
    const c = this.chars.get(id);
    if (c) this.centerOn(c.x, c.y - 24);
  }

  toWorld(sx, sy) {
    return { x: this.cam.x + sx / this.cam.zoom, y: this.cam.y + sy / this.cam.zoom };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.zoom, y: (wy - this.cam.y) * this.cam.zoom };
  }

  // ---- Agents -------------------------------------------------------------

  // Reconciles characters with the latest agent list from the server.
  update(agents) {
    const seen = new Set();
    for (const a of agents) {
      seen.add(a.id);
      let c = this.chars.get(a.id);
      if (!c) {
        const parent = a.parentId && this.chars.get(a.parentId);
        const start = parent ? { x: parent.x, y: parent.y } : feet(DOOR);
        c = { id: a.id, x: start.x, y: start.y, path: [], dir: 'up', spot: null, leaving: false, alpha: 0, sprite: this.pickSprite(a) };
        this.chars.set(a.id, c);
      }
      c.agent = a;
      c.leaving = false;
      this.plan(c);
    }
    for (const c of this.chars.values()) {
      if (!seen.has(c.id) && !c.leaving) {
        c.leaving = true;
        this.release(c);
        const parent = c.agent.parentId && this.chars.get(c.agent.parentId);
        this.walk(c, parent && !parent.leaving ? tileOf(parent.x, parent.y) : DOOR);
      }
    }
  }

  // Decides where a character should go for its agent's current activity.
  // Real agents switch activity every second or two (a tool call, then a look at
  // its result), far faster than a character can cross the office. So: an agent
  // reviewing a result stays put, and other moves wait until the new activity
  // has lasted MOVE_DELAY (THINK_DELAY for thinking), so a burst of quick calls
  // does not send it running. Its bubble still shows the current activity.
  plan(c) {
    const a = c.agent;
    const zone = zoneFor(a.activity);
    if (!c.spot) { c.pending = null; this.sendTo(c, zone); return; }
    if (a.stay || c.spot.key.startsWith(`${zone.id}:`)) { c.pending = null; return; }
    const urgent = a.activity === 'waiting' || a.activity === 'idle' || a.activity === 'subagent';
    if (urgent) { c.pending = null; this.sendTo(c, zone); return; }
    if (c.pending?.zone !== zone) c.pending = { zone, at: this.t };
  }

  pickSprite(a) {
    const all = this.sprites.manifest.character.list.map((ch, i) => ({ ...ch, i }));
    const family = all.filter((ch) => ch.family === a.source);
    const pool = family.length ? family : all;
    // Prefer a look nobody in the office has yet; fall back to the hash.
    const used = new Set([...this.chars.values()].map((c) => c.sprite));
    const start = hash(a.id) % pool.length;
    for (let k = 0; k < pool.length; k++) {
      const ch = pool[(start + k) % pool.length];
      if (!used.has(ch.i)) return ch.i;
    }
    const parent = a.parentId && this.chars.get(a.parentId);
    const idx = parent && pool[start].i === parent.sprite ? (start + 1) % pool.length : start;
    return pool[idx].i;
  }

  release(c) {
    if (c.spot) this.spotOwner.delete(c.spot.key);
    c.spot = null;
  }

  sendTo(c, zone) {
    this.release(c);
    const n = zone.spots.length;
    const start = hash(c.id) % n;
    let spot = null;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const key = `${zone.id}:${i}`;
      if (!this.spotOwner.has(key)) { spot = { key, tile: zone.spots[i].slice(0, 2), face: zone.spots[i][2] }; break; }
    }
    if (!spot) {
      // Zone is full: stand anywhere free inside it.
      const [x, y, w, h] = zone.rect;
      for (let k = 0; k < 80 && !spot; k++) {
        const tx = x + ((hash(c.id) + k * 7) % w), ty = y + ((hash(c.id) >> 4) + k * 3) % h;
        if (!blocked[ty][tx]) spot = { key: `${zone.id}:free:${c.id}`, tile: [tx, ty], face: 'down' };
      }
      spot ||= { key: `${zone.id}:free:${c.id}`, tile: zone.spots[0].slice(0, 2), face: 'down' };
    }
    this.spotOwner.set(spot.key, c.id);
    c.spot = spot;
    this.walk(c, spot.tile);
  }

  walk(c, tile) {
    c.path = findPath(tileOf(c.x, c.y), tile).map(feet);
  }

  step(dt) {
    this.t += dt;
    for (const c of [...this.chars.values()]) {
      if (c.pending && !c.leaving && this.t - c.pending.at >= (c.pending.zone === zoneFor('thinking') ? THINK_DELAY : MOVE_DELAY)) {
        this.sendTo(c, c.pending.zone);
        c.pending = null;
      }
      c.alpha = c.leaving ? c.alpha : Math.min(1, c.alpha + dt * 3);
      const target = c.path[0];
      if (target) {
        const dx = target.x - c.x, dy = target.y - c.y;
        const dist = Math.hypot(dx, dy);
        const move = SPEED * dt;
        if (Math.abs(dx) > Math.abs(dy)) c.dir = dx > 0 ? 'right' : 'left';
        else if (dy !== 0) c.dir = dy > 0 ? 'down' : 'up';
        if (dist <= move) { c.x = target.x; c.y = target.y; c.path.shift(); }
        else { c.x += (dx / dist) * move; c.y += (dy / dist) * move; }
        c.walking = true;
      } else {
        c.walking = false;
        if (c.spot) c.dir = c.spot.face;
        if (c.leaving) {
          c.alpha -= dt * 2;
          if (c.alpha <= 0) {
            this.chars.delete(c.id);
            if (this.selected === c.id) this.selected = null;
            if (this.following === c.id) this.following = null;
          }
        }
      }
    }
    // Camera: follow the selected character, or glide to a target.
    const f = this.following && this.chars.get(this.following);
    if (f) this.camTarget = { x: f.x - this.view.w / 2 / this.cam.zoom, y: f.y - 24 - this.view.h / 2 / this.cam.zoom };
    if (this.camTarget) {
      const k = 1 - Math.exp(-dt * 6);
      this.cam.x += (this.camTarget.x - this.cam.x) * k;
      this.cam.y += (this.camTarget.y - this.cam.y) * k;
      this.clamp();
      if (!f && Math.hypot(this.camTarget.x - this.cam.x, this.camTarget.y - this.cam.y) < 0.5) this.camTarget = null;
    }
  }

  frameFor(c) {
    const activity = c.agent.activity;
    if (c.walking) return { row: `walk_${c.dir}`, frame: Math.floor(this.t * 8) % 4 };
    if (WORKING.has(activity)) {
      if (c.dir === 'down' || c.dir === 'up') return { row: `work_${c.dir}`, frame: Math.floor(this.t * 4) % 4 };
      return { row: `walk_${c.dir}`, frame: 0 };
    }
    if (activity === 'idle') return { row: 'idle_down', frame: 3 };
    if (c.dir === 'down') return { row: 'idle_down', frame: Math.floor(this.t * 2) % 3 };
    return { row: `walk_${c.dir}`, frame: 0 };
  }

  // ---- Drawing ------------------------------------------------------------

  render() {
    const { ctx, sprites, view, cam } = this;
    const k = cam.zoom * view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#7fbf68';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Static layer: only the visible part.
    const vx = Math.max(0, cam.x), vy = Math.max(0, cam.y);
    const vw = Math.min(WORLD_W - vx, view.w / cam.zoom + 2), vh = Math.min(WORLD_H - vy, view.h / cam.zoom + 2);
    ctx.drawImage(this.floor, vx * this.scale, vy * this.scale, vw * this.scale, vh * this.scale, vx, vy, vw, vh);

    // Props and characters, back to front.
    const items = [];
    for (const p of this.props) items.push({ y: p.seat ? p.y * TILE : (p.y + p.h) * TILE, p });
    for (const c of this.chars.values()) items.push({ y: c.y, c });
    items.sort((a, b) => a.y - b.y);
    const left = cam.x - 128, right = cam.x + view.w / cam.zoom + 128, top = cam.y - 160, bottom = cam.y + view.h / cam.zoom + 160;
    for (const it of items) {
      if (it.p) {
        const { p } = it;
        if ((p.x + p.w) * TILE < left || p.x * TILE > right || (p.y + p.h) * TILE < top || p.y * TILE > bottom) continue;
        this.drawProp(p);
      } else if (it.c.x > left && it.c.x < right && it.c.y > top && it.c.y < bottom) {
        this.drawChar(it.c);
      }
    }

    // Screen-space text: sharp and the same size at every zoom.
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (cam.zoom >= 0.45) this.drawZoneLabels();
    for (const c of this.chars.values()) {
      if (c.alpha <= 0) continue;
      const s = this.toScreen(c.x, c.y);
      if (s.x < -150 || s.y < -150 || s.x > view.w + 150 || s.y > view.h + 150) continue;
      ctx.globalAlpha = Math.max(0, c.alpha);
      this.drawName(c, s);
      if (!c.leaving) this.drawBubble(c, s);
      ctx.globalAlpha = 1;
    }
  }

  drawProp(p) {
    const { ctx } = this;
    const img = this.sprites.props[p.type];
    const meta = this.sprites.manifest.props[p.type];
    const cx = (p.x + p.w / 2) * TILE, by = (p.y + p.h) * TILE;
    if (!img || !meta) {
      // Art not drawn yet: a plain block keeps the layout readable.
      ctx.fillStyle = 'rgba(90, 70, 110, 0.35)';
      ctx.beginPath(); ctx.roundRect(p.x * TILE + 3, p.y * TILE + 3, p.w * TILE - 6, p.h * TILE - 6, 6); ctx.fill();
      return;
    }
    // Art wider than its footprint (plus a little overhang) is scaled down to fit.
    const fit = Math.min(1, (p.w + 0.6) * TILE / (meta.w / this.scale));
    const w = (meta.w / this.scale) * fit, h = (meta.h / this.scale) * fit;
    if (!p.seat) {
      ctx.fillStyle = 'rgba(60, 40, 80, 0.16)';
      ctx.beginPath(); ctx.ellipse(cx, by - 3, w * 0.46, Math.min(9, h * 0.12), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.drawImage(img, cx - w / 2, by - h + (p.seat ? 4 : 0), w, h);
  }

  drawChar(c) {
    const { ctx, sprites } = this;
    const m = sprites.manifest.character;
    const { row, frame } = this.frameFor(c);
    const r = m.rows.indexOf(row);
    const s = c.agent.kind === 'subagent' ? SUB_SCALE : 1;
    const size = CHAR * s;
    ctx.globalAlpha = Math.max(0, c.alpha);
    // Ground shadow, plus a ring when selected or hovered.
    ctx.fillStyle = 'rgba(40, 30, 60, 0.22)';
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 1, 13 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
    if (c.id === this.selected || c.id === this.hover) {
      ctx.strokeStyle = c.id === this.selected ? '#ffd84d' : 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(c.x, c.y - 1, 17 * s, 7 * s, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const F = m.frame;
    const x = c.x - size / 2, y = c.y - FEET * s;
    ctx.drawImage(sprites.chars[c.sprite], frame * F, r * F, F, F, x, y, size, size);
    c.box = { x: c.x - 16 * s, y: y + 4 * s, w: 32 * s, h: size - 4 * s };
    ctx.globalAlpha = 1;
  }

  drawName(c, s) {
    const { ctx } = this;
    const a = c.agent;
    const sub = a.kind === 'subagent';
    const name = a.name;
    // In the shared office the tag also says whose agent it is.
    const owner = this.showOwner && !sub ? a.userName : '';
    const project = [owner, !sub && a.project ? a.project : ''].filter(Boolean).join(' · ');
    ctx.font = `700 ${sub ? 11 : 12}px ${FONT}`;
    const nw = ctx.measureText(name).width;
    ctx.font = `500 ${sub ? 11 : 12}px ${FONT}`;
    const pw = project ? ctx.measureText(' · ' + project).width : 0;
    const w = Math.ceil(nw + pw) + 22, h = sub ? 20 : 22;
    const x = Math.round(s.x - w / 2), y = Math.round(s.y + 4);
    ctx.fillStyle = 'rgba(28, 24, 44, 0.82)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = SOURCE_COLOR[a.source] || '#8a7ae8';
    ctx.beginPath(); ctx.arc(x + 9, y + h / 2, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${sub ? 11 : 12}px ${FONT}`;
    ctx.fillText(name, x + 16, y + h / 2 + 0.5);
    if (project) {
      ctx.fillStyle = '#c9c2e6';
      ctx.font = `500 ${sub ? 11 : 12}px ${FONT}`;
      ctx.fillText(' · ' + project, x + 16 + nw, y + h / 2 + 0.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  drawBubble(c, s) {
    const { ctx, sprites } = this;
    const fr = sprites.manifest.fx.rows.indexOf(c.agent.activity);
    if (fr < 0) return;
    const scale = c.agent.kind === 'subagent' ? SUB_SCALE : 1;
    const head = (FEET - 4) * scale * this.cam.zoom; // screen px from feet to top of head
    const bob = Math.round(Math.sin(this.t * 3 + (hash(c.id) % 7)) * 2);
    const size = 32, x = Math.round(s.x - size / 2), y = Math.round(s.y - head - size - 10 + bob);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(40, 30, 60, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, size, size, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x - 5, y + size - 0.5); ctx.lineTo(s.x, y + size + 6); ctx.lineTo(s.x + 5, y + size - 0.5); ctx.closePath(); ctx.fill();
    const fx = sprites.manifest.fx.size;
    ctx.drawImage(sprites.fx, 0, fr * fx, fx, fx, x + 4, y + 4, size - 8, size - 8);
  }

  drawZoneLabels() {
    const { ctx } = this;
    ctx.font = `700 13px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const z of ZONES) {
      const [x, y] = z.rect;
      const p = this.toScreen(x * TILE, y * TILE);
      if (p.x > this.view.w || p.y > this.view.h) continue;
      const w = Math.ceil(ctx.measureText(z.label).width) + 20;
      const px = Math.round(p.x + 8), py = Math.round(p.y + 8);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath(); ctx.roundRect(px, py, w, 24, 12); ctx.fill();
      ctx.fillStyle = '#3b3156';
      ctx.fillText(z.label, px + 10, py + 12.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // Small overview of the whole office with every agent and the visible area.
  renderMinimap(mini) {
    const mctx = mini.getContext('2d');
    const k = mini.width / WORLD_W;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(this.floor, 0, 0, mini.width, mini.height);
    mctx.fillStyle = 'rgba(70, 55, 95, 0.35)';
    for (const p of this.props) if (!p.seat) mctx.fillRect(p.x * TILE * k, p.y * TILE * k, p.w * TILE * k, p.h * TILE * k);
    for (const c of this.chars.values()) {
      mctx.fillStyle = c.id === this.selected ? '#ffd84d' : SOURCE_COLOR[c.agent.source] || '#8a7ae8';
      mctx.beginPath(); mctx.arc(c.x * k, (c.y - 10) * k, c.agent.kind === 'subagent' ? 2.5 : 3.5, 0, Math.PI * 2); mctx.fill();
    }
    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 2;
    mctx.strokeRect(this.cam.x * k, this.cam.y * k, (this.view.w / this.cam.zoom) * k, (this.view.h / this.cam.zoom) * k);
  }

  hit(x, y) {
    const list = [...this.chars.values()].filter((c) => c.box && !c.leaving).sort((a, b) => b.y - a.y);
    return list.find((c) => x >= c.box.x && x <= c.box.x + c.box.w && y >= c.box.y && y <= c.box.y + c.box.h + 10) || null;
  }
}
