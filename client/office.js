import { TILE, COLS, ROWS, ZONES, FURNITURE, DOOR, SEATS } from './office-map.js';

const SPEED = 110; // px per second
export const SCALE = 2;      // device pixels per office pixel
const CHAR = 1.5;            // characters are drawn 1.5x (3 device px per art px)
const ZONE_OF = Object.fromEntries(ZONES.flatMap((z) => z.activities.map((a) => [a, z])));
const WORKING = new Set(['editing', 'talking', 'reading', 'searching', 'running', 'mcp']);

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

// Walkable grid: walls on the border and top two rows; furniture blocks except seats.
const blocked = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => y < 2 || x === 0 || x === COLS - 1 || y === ROWS - 1));
for (const [type, x, y, w, h] of FURNITURE) {
  if (SEATS.has(type)) continue;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (blocked[j]) blocked[j][i] = true;
}

function findPath(from, to) {
  const key = (x, y) => y * COLS + x;
  const prev = new Map([[key(...from), null]]);
  const queue = [from];
  while (queue.length) {
    const [x, y] = queue.shift();
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
    this.chars = new Map();
    this.spotOwner = new Map(); // "zone:index" -> agent id
    this.selected = null;
    this.hover = null;
    this.t = 0;
  }

  // Reconciles characters with the latest agent list from the server.
  update(agents) {
    const seen = new Set();
    for (const a of agents) {
      seen.add(a.id);
      let c = this.chars.get(a.id);
      if (!c) {
        const parent = a.parentId && this.chars.get(a.parentId);
        const start = parent ? { x: parent.x, y: parent.y } : feet(DOOR);
        c = { id: a.id, x: start.x, y: start.y, path: [], dir: 'down', spot: null, leaving: false, alpha: 0, sprite: this.pickSprite(a) };
        this.chars.set(a.id, c);
      }
      const prevActivity = c.agent?.activity;
      c.agent = a;
      c.leaving = false;
      if (a.activity !== prevActivity || !c.spot) this.sendTo(c, zoneFor(a.activity));
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

  pickSprite(a) {
    const family = this.sprites.characters.map((ch, i) => ({ ...ch, i })).filter((ch) => ch.family === a.source);
    const pool = family.length ? family : this.sprites.characters.map((ch, i) => ({ ...ch, i }));
    let idx = hash(a.id) % pool.length;
    const parent = a.parentId && this.chars.get(a.parentId);
    if (parent && pool[idx].i === parent.sprite) idx = (idx + 1) % pool.length;
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
      for (let k = 0; k < 50 && !spot; k++) {
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
          if (c.alpha <= 0) { this.chars.delete(c.id); if (this.selected === c.id) this.selected = null; }
        }
      }
    }
  }

  frameFor(c) {
    const activity = c.agent.activity;
    if (c.walking) return { row: `walk_${c.dir}`, frame: Math.floor(this.t * 8) % 4 };
    if (WORKING.has(activity)) {
      if (c.dir === 'down' || c.dir === 'up') return { row: `work_${c.dir}`, frame: Math.floor(this.t * 5) % 4 };
      return { row: `walk_${c.dir}`, frame: 0 };
    }
    if (activity === 'idle') return { row: 'idle_down', frame: 3 };
    if (c.dir === 'down') return { row: 'idle_down', frame: Math.floor(this.t * 2.5) % 4 };
    return { row: `walk_${c.dir}`, frame: 0 };
  }

  render() {
    const { ctx, sprites } = this;
    const F = sprites.frame;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprites.office, 0, 0);
    this.drawLabels();

    const list = [...this.chars.values()].sort((a, b) => a.y - b.y);
    for (const c of list) {
      const { row, frame } = this.frameFor(c);
      const r = sprites.rows.indexOf(row);
      const small = c.agent.kind === 'subagent';
      const s = small ? 1 : CHAR; // subagents are drawn smaller
      const size = F * s;
      const x = c.x - size / 2, y = c.y - size + 3 * s;
      ctx.globalAlpha = Math.max(0, c.alpha);
      if (c.id === this.selected || c.id === this.hover) {
        ctx.fillStyle = c.id === this.selected ? 'rgba(255, 230, 120, 0.55)' : 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 1, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.drawImage(sprites.chars[c.sprite], frame * F, r * F, F, F, snap(x), snap(y), size, size);
      c.box = { x: c.x - 9 * s, y: y + 2 * s, w: 18 * s, h: size - 4 * s };

      // Status icon above the head
      if (!c.leaving) {
        const fr = sprites.fxRows.indexOf(c.agent.activity);
        if (fr >= 0) {
          const bob = Math.round(Math.sin(this.t * 4 + (hash(c.id) % 7)) * 1.5);
          const ff = Math.floor(this.t * 2) % 2;
          ctx.drawImage(sprites.fx, ff * 16, fr * 16, 16, 16, snap(c.x - 12), snap(y - 20 + bob), 24, 24);
        }
      }
      this.drawName(c);
      ctx.globalAlpha = 1;
    }
  }

  drawName(c) {
    const { ctx } = this;
    const a = c.agent;
    const text = a.kind === 'subagent' ? a.name : `${a.name}${a.project ? ' · ' + a.project : ''}`;
    ctx.font = '600 10px ui-rounded, system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 10;
    const x = Math.round(c.x - w / 2), y = Math.round(c.y + 3);
    ctx.fillStyle = 'rgba(43, 33, 53, 0.78)';
    roundRect(ctx, x, y, w, 14, 7); ctx.fill();
    ctx.fillStyle = a.source === 'codex' ? '#9ff0d6' : '#ffd2bd';
    ctx.fillText(text, x + 5, y + 10.5);
  }

  drawLabels() {
    const { ctx } = this;
    ctx.font = '700 11px ui-rounded, system-ui, sans-serif';
    for (const z of ZONES) {
      const [x, y] = z.rect;
      const w = Math.ceil(ctx.measureText(z.label).width) + 12;
      const px = x * TILE + 6, py = y * TILE + 6;
      ctx.fillStyle = 'rgba(255, 253, 246, 0.85)';
      roundRect(ctx, px, py, w, 16, 8); ctx.fill();
      ctx.fillStyle = '#4a3f5c';
      ctx.fillText(z.label, px + 6, py + 12);
    }
  }

  hit(x, y) {
    const list = [...this.chars.values()].filter((c) => c.box && !c.leaving).sort((a, b) => b.y - a.y);
    return list.find((c) => x >= c.box.x && x <= c.box.x + c.box.w && y >= c.box.y && y <= c.box.y + c.box.h + 14) || null;
  }
}

const snap = (v) => Math.round(v * SCALE) / SCALE;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
