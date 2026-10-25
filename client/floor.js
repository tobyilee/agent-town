import {
  TILE, COLS, ROWS, FURNITURE, FLAT, BUILDING, DOOR_GAP, HALL_FLOOR, WALLS,
  zoneAt, isBuildingWall, isInteriorWall, isDoor,
} from './office-map.js';

// Paints everything that never moves (floors, walls, rugs, wall art) once into
// an offscreen canvas. The office renderer then copies the visible part each frame.

// tex: texture from the sprite manifest (drawn by Codex); wash: white overlay that
// softens it. base/line: flat colors used for the minimap and when a texture is missing.
const FLOORS = {
  herringbone: { tex: 'herringbone', wash: 0.12, base: '#e6cfaa', line: '#d1b48a' },
  woodWarm: { tex: 'woodWarm', wash: 0.1, base: '#d9a86c', line: '#bb8a52' },
  carpetBlue: { tex: 'carpetBlue', wash: 0.4, base: '#a7bedb', line: '#93aacb' },
  carpetGreen: { tex: 'carpetGreen', wash: 0.4, base: '#b3cba5', line: '#9db88e' },
  carpetPurple: { tex: 'carpetPurple', wash: 0.32, base: '#cbbde6', line: '#b6a6d6' },
  carpetOrange: { tex: 'carpetOrange', wash: 0.3, base: '#f3c7a8', line: '#e2b08e' },
  concrete: { tex: 'concrete', wash: 0.05, base: '#d3d0cb', line: '#bdb9b2' },
  grass: { tex: 'grass', wash: 0, base: '#8fcf5f', line: '#79b94d' },
  tileTeal: { tile: true, base: '#b3e1da', alt: '#a6d8d1', line: '#8fc6be' },
};

const WALL = {
  face: '#f6efe6', faceLow: '#ece1d3', skirt: '#c9a37a', skirtDark: '#a98258',
  cap: '#4f4468', capLight: '#6c6089', door: '#8a6a4c',
};
const T = TILE;

function hash(...n) {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v | 0), 16777619) ^ (h >>> 13);
  return (h >>> 0) / 4294967296;
}

function inBuilding(x, y) {
  const { x: bx, y: by, w, h } = BUILDING;
  return x >= bx && y >= by && x < bx + w && y < by + h;
}

// The floor a tile shows. Doorways take the floor of the room they open into.
export function floorAt(x, y) {
  if (!inBuilding(x, y)) return FLOORS.grass;
  const z = zoneAt(x, y);
  if (z) return FLOORS[z.floor];
  if (isDoor(x, y)) {
    const below = zoneAt(x, y + 1), right = zoneAt(x + 1, y);
    if (isInteriorWall(x, y - 1) || isInteriorWall(x, y + 1)) return FLOORS[right?.floor || HALL_FLOOR];
    return FLOORS[below?.floor || HALL_FLOOR];
  }
  return FLOORS[HALL_FLOOR];
}

export function floorColor(x, y) {
  return floorAt(x, y).base;
}

function fillFloor(ctx, patterns, f, x, y, w, h) {
  const pat = f.tex && patterns[f.tex];
  if (f.tile) {
    for (let j = 0; j < h; j += T) for (let i = 0; i < w; i += T) {
      const tx = Math.floor((x + i) / T), ty = Math.floor((y + j) / T);
      ctx.fillStyle = (tx + ty) % 2 ? f.alt : f.base;
      ctx.fillRect(x + i, y + j, Math.min(T, w - i), Math.min(T, h - j));
      ctx.fillStyle = f.line;
      ctx.fillRect(x + i, y + j + T - 1, Math.min(T, w - i), 1);
      ctx.fillRect(x + i + T - 1, y + j, 1, Math.min(T, h - j));
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(x + i, y + j, Math.min(T, w - i) - 1, 1);
    }
    return;
  }
  ctx.fillStyle = pat || f.base;
  ctx.fillRect(x, y, w, h);
  if (pat && f.wash) {
    ctx.fillStyle = `rgba(255, 253, 248, ${f.wash})`;
    ctx.fillRect(x, y, w, h);
  }
}

function paintFloors(ctx, patterns) {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (isVertical(x, y)) { // wall or doorway in a vertical wall
      // Seen from above: each half shows the floor of the room on that side.
      fillFloor(ctx, patterns, floorAt(x - 1, y), x * T, y * T, T / 2, T);
      fillFloor(ctx, patterns, floorAt(x + 1, y), x * T + T / 2, y * T, T / 2, T);
    } else {
      fillFloor(ctx, patterns, floorAt(x, y), x * T, y * T, T, T);
    }
  }
}

const vertical = new Set();
for (const [x1, y1, x2, y2] of WALLS) if (x1 === x2) for (let y = y1; y <= y2; y++) vertical.add(`${x1},${y}`);
function isVertical(x, y) {
  return vertical.has(`${x},${y}`);
}

function paintRug(ctx, x, y, w, h, round) {
  const px = x * T + 6, py = y * T + 6, pw = w * T - 12, ph = h * T - 12;
  const colors = round ? ['#b9a5e0', '#ddd2f4', '#a28ccf'] : ['#e9c3a8', '#f8e3d3', '#d6a588'];
  ctx.save();
  ctx.shadowColor = 'rgba(60, 40, 80, 0.18)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  if (round) ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(px, py, pw, ph, 10);
  ctx.fillStyle = colors[0]; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = colors[1]; ctx.lineWidth = 3;
  ctx.beginPath();
  if (round) ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2 - 9, ph / 2 - 9, 0, 0, Math.PI * 2);
  else ctx.roundRect(px + 8, py + 8, pw - 16, ph - 16, 6);
  ctx.stroke();
  ctx.fillStyle = colors[2];
  for (let i = 0; i < pw / 18; i++) for (let j = 0; j < ph / 18; j++) {
    if ((i + j) % 2) continue;
    ctx.beginPath(); ctx.arc(px + 18 + i * 18, py + 18 + j * 18, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function paintPath(ctx, x, y, w, h) {
  for (let j = 0; j < h * 2; j++) for (let i = 0; i < w * 2; i++) {
    const cx = x * T + i * 16 + 8 + (hash(i, j) - 0.5) * 4, cy = y * T + j * 16 + 8 + (hash(j, i) - 0.5) * 4;
    ctx.fillStyle = '#a9a196';
    ctx.beginPath(); ctx.ellipse(cx, cy + 1.5, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e2dcd2';
    ctx.beginPath(); ctx.ellipse(cx, cy, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// A wall face seen from the front: dark cap on top, light face, wooden skirting.
function wallFace(ctx, x, y, w, h, cap = 7) {
  const face = ctx.createLinearGradient(0, y, 0, y + h);
  face.addColorStop(0, WALL.face); face.addColorStop(1, WALL.faceLow);
  ctx.fillStyle = face; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = WALL.skirt; ctx.fillRect(x, y + h - 6, w, 6);
  ctx.fillStyle = WALL.skirtDark; ctx.fillRect(x, y + h - 6, w, 1.5);
  ctx.fillStyle = WALL.cap; ctx.fillRect(x, y - cap, w, cap);
  ctx.fillStyle = WALL.capLight; ctx.fillRect(x, y - cap + 2, w, 2);
}

// A wall seen from above: just its top.
function wallTop(ctx, x, y, w, h) {
  ctx.fillStyle = WALL.cap; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = WALL.capLight; ctx.fillRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
}

// Soft shadow a wall casts on the floor in front of it.
function shadow(ctx, x, y, w, h, dir) {
  const g = dir === 'down' ? ctx.createLinearGradient(0, y, 0, y + h)
    : dir === 'left' ? ctx.createLinearGradient(x + w, 0, x, 0) : ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(60, 40, 90, 0.2)'); g.addColorStop(1, 'rgba(60, 40, 90, 0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}

function paintInteriorWalls(ctx) {
  // Horizontal walls: a face one tile tall, its cap on top.
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!isInteriorWall(x, y) || isVertical(x, y)) continue;
    wallFace(ctx, x * T, y * T + 8, T, T - 8, 8);
    if (!isInteriorWall(x, y + 1)) shadow(ctx, x * T, (y + 1) * T, T, 12, 'down');
  }
  // Door frames in horizontal walls.
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!isDoor(x, y) || isVertical(x, y)) continue;
    if (isInteriorWall(x - 1, y) && !isVertical(x - 1, y)) { ctx.fillStyle = WALL.door; ctx.fillRect(x * T, y * T, 4, T); }
    if (isInteriorWall(x + 1, y) && !isVertical(x + 1, y)) { ctx.fillStyle = WALL.door; ctx.fillRect((x + 1) * T - 4, y * T, 4, T); }
  }
  // Vertical walls: a narrow top, running into the cap of the wall below.
  for (const [x1, y1, x2, y2] of WALLS) {
    if (x1 !== x2) continue;
    for (let y = y1; y <= y2; y++) {
      if (isDoor(x1, y)) continue;
      const cx = x1 * T + T / 2 - 6;
      wallTop(ctx, cx, y * T - (y === y1 ? 8 : 0), 12, T + (y === y1 ? 8 : 0));
      shadow(ctx, cx + 12, y * T, 8, T, 'right');
      shadow(ctx, cx - 8, y * T, 8, T, 'left');
      // Small face where the wall ends above a doorway or the corridor.
      if (!isWall(x1, y + 1)) wallFace(ctx, cx, (y + 1) * T - 10, 12, 10, 0);
    }
  }
}

function isWall(x, y) {
  return isBuildingWall(x, y) || isInteriorWall(x, y);
}

function paintBuildingWalls(ctx) {
  const { x, y, w, h } = BUILDING;
  const L = x * T, Tp = y * T, R = (x + w) * T, B = (y + h) * T;
  wallFace(ctx, L, Tp, R - L, 2 * T, 0);
  shadow(ctx, L, Tp + 2 * T, R - L, 14, 'down');
  wallTop(ctx, L - 4, Tp - 12, R - L + 8, 14);
  wallTop(ctx, L - 4, Tp - 12, T / 2 + 4, B - Tp + 12);
  wallTop(ctx, R - T / 2, Tp - 12, T / 2 + 4, B - Tp + 12);
  shadow(ctx, L + T / 2, Tp + 2 * T, 10, B - Tp - 2 * T - T / 2, 'right');
  shadow(ctx, R - T / 2 - 10, Tp + 2 * T, 10, B - Tp - 2 * T - T / 2, 'left');
  const [d0, d1] = DOOR_GAP;
  wallTop(ctx, L - 4, B - T / 2, d0 * T - L + 4, T / 2 + 4);
  wallTop(ctx, (d1 + 1) * T, B - T / 2, R - (d1 + 1) * T + 4, T / 2 + 4);
  // Door mat at the entrance.
  ctx.fillStyle = '#7d5f45'; ctx.beginPath(); ctx.roundRect(d0 * T + 4, B - T + 5, 2 * T - 8, T - 9, 4); ctx.fill();
  ctx.fillStyle = '#a07b58'; ctx.beginPath(); ctx.roundRect(d0 * T + 8, B - T + 9, 2 * T - 16, T - 17, 3); ctx.fill();
}

// Daylight falling through the windows onto the floor.
function paintWindowLight(ctx) {
  for (const [type, x, y, w] of FURNITURE) {
    if (type !== 'window' || y !== BUILDING.y) continue;
    const top = (y + 2) * T, cx = (x + w / 2) * T;
    const g = ctx.createLinearGradient(0, top, 0, top + 3 * T);
    g.addColorStop(0, 'rgba(255, 248, 215, 0.32)'); g.addColorStop(1, 'rgba(255, 248, 215, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - w * T * 0.42, top); ctx.lineTo(cx + w * T * 0.42, top);
    ctx.lineTo(cx + w * T * 0.42 + 24, top + 3 * T); ctx.lineTo(cx - w * T * 0.42 + 24, top + 3 * T);
    ctx.closePath(); ctx.fill();
  }
}

// Wall art from the sprite sheet, fitted inside its footprint and centered on it.
function paintFlatProp(ctx, sprites, type, x, y, w, h) {
  const img = sprites.props[type];
  const meta = sprites.manifest.props[type];
  if (!img || !meta) return;
  const s = sprites.manifest.scale;
  let dw = meta.w / s, dh = meta.h / s;
  const onInteriorWall = h === 1 && isInteriorWall(x, y);
  const boxW = w * T, boxH = onInteriorWall ? T - 14 : h * T;
  const k = Math.min(1, boxW / dw, boxH / dh);
  dw *= k; dh *= k;
  const cy = onInteriorWall ? y * T + 8 + (T - 14) / 2 : (y + h / 2) * T - (type === 'window' ? 2 : 0);
  ctx.save();
  ctx.shadowColor = 'rgba(60, 40, 80, 0.25)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  ctx.drawImage(img, (x + w / 2) * T - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();
}

export function paintStatic(sprites, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * T * scale;
  canvas.height = ROWS * T * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingQuality = 'high';
  const patterns = {};
  for (const [name, img] of Object.entries(sprites.textures || {})) {
    if (!img) continue;
    const p = ctx.createPattern(img, 'repeat');
    p.setTransform(new DOMMatrix().scale(1 / sprites.manifest.scale));
    patterns[name] = p;
  }
  paintFloors(ctx, patterns);
  paintWindowLight(ctx);
  for (const [type, x, y, w, h] of FURNITURE) {
    if (type === 'rug' || type === 'rugRound') paintRug(ctx, x, y, w, h, type === 'rugRound');
    else if (type === 'pathStone') paintPath(ctx, x, y, w, h);
  }
  paintInteriorWalls(ctx);
  paintBuildingWalls(ctx);
  for (const [type, x, y, w, h] of FURNITURE) {
    if (FLAT.has(type) && sprites.props[type]) paintFlatProp(ctx, sprites, type, x, y, w, h);
  }
  return canvas;
}
