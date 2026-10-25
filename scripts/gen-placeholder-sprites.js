// Generates the placeholder pixel-art sprites in client/assets/sprites/.
// Run: npm run sprites. Replace them with Codex-generated art via
// scripts/gen-sprites-codex.sh; both follow sprites/SPEC.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bitmap, shade } from './png.js';
import { TILE, COLS, ROWS, ZONES, FURNITURE } from '../client/office-map.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets', 'sprites');
fs.mkdirSync(OUT, { recursive: true });

const F = 32; // character frame size
const OUTLINE = '#2b2135';
const DIRS = ['down', 'left', 'right', 'up'];
// Rows of every character sheet, 4 frames each.
const ROWS_SPEC = ['walk_down', 'walk_left', 'walk_right', 'walk_up', 'work_down', 'work_up', 'idle_down'];

// Warm palettes are used for Claude Code agents, cool ones for Codex.
const PALETTES = [
  { skin: '#ffd9b8', hair: '#7a4a2a', shirt: '#e8875a', pants: '#4a4e7a' },
  { skin: '#f6c9a0', hair: '#2e2433', shirt: '#f2b544', pants: '#5a4a3a' },
  { skin: '#ffe0c7', hair: '#d9783c', shirt: '#d9605a', pants: '#3d4b63' },
  { skin: '#e8b48a', hair: '#4b2f22', shirt: '#f4a6b8', pants: '#46506b' },
  { skin: '#ffd9b8', hair: '#3a3f5c', shirt: '#5aa8e8', pants: '#33384f' },
  { skin: '#f0c19a', hair: '#1f2a33', shirt: '#4cc6a0', pants: '#40455e' },
  { skin: '#ffe3cc', hair: '#a8b4c8', shirt: '#8a7ae8', pants: '#2f3348' },
  { skin: '#d9a07a', hair: '#26222e', shirt: '#6ad0e0', pants: '#3b3e52' },
];

function drawChar(b, ox, oy, pal, dir, pose, frame) {
  const skinD = shade(pal.skin, -0.15), hairD = shade(pal.hair, -0.25), shirtD = shade(pal.shirt, -0.2);
  const walking = pose === 'walk';
  const bob = walking ? (frame % 2 === 1 ? -1 : 0) : pose === 'idle' ? (frame === 1 || frame === 2 ? 1 : 0) : pose === 'work' ? (frame % 2) : 0;
  const P = (x, y, w, h, c) => b.rect(ox + x, oy + y, w, h, c);

  b.ellipse(ox + 16, oy + 29.5, 8, 2, [0, 0, 0, 60]);

  // Legs
  const side = dir === 'left' || dir === 'right';
  let legs;
  if (!walking) legs = side ? [[13, 0], [16, 0]] : [[12, 0], [17, 0]];
  else if (side) legs = frame === 1 ? [[11, 0], [18, -1]] : frame === 3 ? [[18, 0], [11, -1]] : [[13, 0], [16, 0]];
  else legs = frame === 1 ? [[12, -1], [17, 0]] : frame === 3 ? [[12, 0], [17, -1]] : [[12, 0], [17, 0]];
  for (const [lx, lift] of legs) {
    P(lx - 1, 23 + lift, 5, 7, OUTLINE);
    P(lx, 23 + lift, 3, 5, pal.pants);
    P(lx, 28 + lift, 3, 1, '#3a2e3f');
  }

  // Body
  const by = 17 + bob;
  P(9, by - 1, 14, 9, OUTLINE);
  P(10, by, 12, 7, pal.shirt);
  P(20, by, 2, 7, shirtD);
  P(10, by + 6, 12, 1, shirtD);

  // Arms
  if (pose === 'work') {
    const up = frame % 2 === 0;
    if (dir === 'up') {
      P(7, by + (up ? 0 : 1), 3, 5, OUTLINE); P(8, by + (up ? 1 : 2), 1, 3, pal.shirt);
      P(22, by + (up ? 1 : 0), 3, 5, OUTLINE); P(23, by + (up ? 2 : 1), 1, 3, pal.shirt);
    } else {
      P(8, by + 1, 3, 4, OUTLINE); P(9, by + 1, 1, 3, pal.shirt);
      P(21, by + 1, 3, 4, OUTLINE); P(22, by + 1, 1, 3, pal.shirt);
      P(11, by + (up ? 3 : 4), 3, 2, pal.skin); P(18, by + (up ? 4 : 3), 3, 2, pal.skin);
    }
  } else if (!side) {
    const swing = walking ? (frame === 1 ? 1 : frame === 3 ? -1 : 0) : 0;
    P(7, by + swing, 3, 7, OUTLINE); P(8, by + swing, 1, 5, pal.shirt); P(8, by + 5 + swing, 1, 1, pal.skin);
    P(22, by - swing, 3, 7, OUTLINE); P(23, by - swing, 1, 5, pal.shirt); P(23, by + 5 - swing, 1, 1, pal.skin);
  } else {
    const ax = dir === 'left' ? 14 : 15;
    const swing = walking ? (frame === 1 ? -2 : frame === 3 ? 2 : 0) : 0;
    P(ax + swing, by + 1, 3, 6, shirtD); P(ax + swing, by + 6, 3, 1, pal.skin);
  }

  // Head
  const hy = 2 + bob;
  b.blob(ox + 7, oy + hy, 18, 16, pal.skin, OUTLINE);
  P(8, hy + 14, 16, 1, skinD);
  if (dir === 'up') {
    P(8, hy + 1, 16, 13, pal.hair);
    P(8, hy + 12, 16, 2, hairD);
  } else {
    P(8, hy + 1, 16, 5, pal.hair);
    P(8, hy + 6, 16, 1, hairD);
    if (dir === 'down') {
      P(8, hy + 6, 2, 6, pal.hair); P(22, hy + 6, 2, 6, pal.hair);
      for (const x of [11, 15, 19]) P(x, hy + 6, 2, 1, pal.hair);
    } else {
      const back = dir === 'left' ? 17 : 8;
      P(back, hy + 6, 7, 7, pal.hair);
      P(back, hy + 12, 7, 1, hairD);
    }
    // Eyes
    const blink = pose === 'idle' && frame === 3;
    const eyes = dir === 'down' ? [11, 19] : dir === 'left' ? [10] : [20];
    for (const ex of eyes) {
      if (blink) P(ex, hy + 10, 2, 1, OUTLINE);
      else { P(ex, hy + 8, 2, 3, OUTLINE); P(ex, hy + 8, 1, 1, '#ffffff'); }
    }
    const blush = dir === 'down' ? [9, 21] : dir === 'left' ? [9] : [21];
    for (const bx of blush) P(bx, hy + 11, 2, 1, '#f4a0a0');
    if (dir === 'down') P(15, hy + 12, 2, 1, skinD);
  }
}

function characterSheet(pal) {
  const b = new Bitmap(F * 4, F * ROWS_SPEC.length);
  ROWS_SPEC.forEach((row, r) => {
    const [pose, dir] = row.split('_');
    for (let f = 0; f < 4; f++) drawChar(b, f * F, r * F, pal, dir, pose, f);
  });
  return b;
}

// Status icons shown above heads: one row per activity, 2 frames of 16x16.
const FX = ['thinking', 'talking', 'reading', 'editing', 'searching', 'running', 'mcp', 'subagent', 'waiting', 'idle'];
function fxSheet() {
  const b = new Bitmap(32, 16 * FX.length);
  FX.forEach((name, r) => {
    for (let f = 0; f < 2; f++) {
      const ox = f * 16, oy = r * 16;
      const P = (x, y, w, h, c) => b.rect(ox + x, oy + y, w, h, c);
      const bubble = () => { b.blob(ox + 1, oy + 1, 14, 12, '#ffffff', OUTLINE); P(6, 13, 3, 1, OUTLINE); P(7, 12, 1, 2, '#ffffff'); P(7, 14, 1, 1, OUTLINE); };
      switch (name) {
        case 'thinking':
          b.ellipse(ox + 8, oy + 6, 6.5, 4.5, OUTLINE); b.ellipse(ox + 8, oy + 6, 5.5, 3.5, '#ffffff');
          P(3, 12, 2, 2, OUTLINE); P(1, 14, 1, 1, OUTLINE);
          for (let i = 0; i < 3; i++) P(5 + i * 3, f === 0 && i === 2 ? 5 : 6, 2, 2, i <= f + 1 ? '#8a7ae8' : '#d9d2f5');
          break;
        case 'talking':
          bubble();
          P(4, 4, 8, 1, '#e8875a'); P(4, 7, 6 + f * 2, 1, '#e8875a'); P(4, 10, 4, 1, '#cccccc');
          break;
        case 'reading':
          P(1, 4 - f, 14, 9, OUTLINE); P(2, 5 - f, 5, 7, '#fff7e0'); P(9, 5 - f, 5, 7, '#fff7e0'); P(7, 4 - f, 2, 9, '#7a4a2a');
          for (let i = 0; i < 3; i++) { P(3, 6 + i * 2 - f, 3, 1, '#9a8f7a'); P(10, 6 + i * 2 - f, 3, 1, '#9a8f7a'); }
          break;
        case 'editing':
          for (let i = 0; i < 9; i++) { P(3 + i, 12 - i - f, 3, 2, i < 7 ? '#f2b544' : '#f4a0a0'); }
          P(2, 13 - f, 2, 2, OUTLINE); P(12, 13, 3, 1, '#5aa8e8');
          break;
        case 'searching':
          b.ellipse(ox + 6 + f, oy + 6, 5, 5, OUTLINE); b.ellipse(ox + 6 + f, oy + 6, 3.5, 3.5, '#bfe6ff');
          P(4 + f, 4, 2, 1, '#ffffff');
          for (let i = 0; i < 4; i++) P(9 + i + f, 9 + i, 2, 2, '#7a4a2a');
          break;
        case 'running':
          b.blob(ox, oy + 2, 16, 12, '#2e3440', OUTLINE); P(1, 3, 14, 2, '#5a6070');
          P(3, 7, 1, 1, '#4cc6a0'); P(4, 8, 1, 1, '#4cc6a0'); P(3, 9, 1, 1, '#4cc6a0');
          if (f === 0) P(6, 9, 3, 1, '#ffffff');
          break;
        case 'mcp':
          for (const [x, y, w] of [[8, 1, 4], [7, 3, 4], [6, 5, 4], [4, 7, 8], [7, 9, 4], [6, 11, 3], [5, 13, 2]]) { P(x - 1, y, w + 2, 2, OUTLINE); }
          for (const [x, y, w] of [[8, 1, 3], [7, 3, 3], [6, 5, 3], [5, 7, 6], [7, 9, 3], [6, 11, 2], [5, 13, 1]]) { P(x, y, w, 2, f ? '#ffe680' : '#f2c544'); }
          break;
        case 'subagent':
          for (const [cx, col] of [[5, '#e8875a'], [11, '#5aa8e8']]) {
            b.ellipse(ox + cx, oy + 5 - (cx === 5 ? f : 1 - f), 3, 3, OUTLINE); b.ellipse(ox + cx, oy + 5 - (cx === 5 ? f : 1 - f), 2, 2, '#ffd9b8');
            P(cx - 3, 9, 6, 5, OUTLINE); P(cx - 2, 10, 4, 4, col);
          }
          break;
        case 'waiting':
          P(3, 7, 9, 7, OUTLINE); P(4, 8, 7, 5, '#ffffff'); P(4, 8, 7, 1, '#7a4a2a'); P(12, 8, 2, 4, OUTLINE);
          for (const x of [5, 8]) { P(x + f, 2, 1, 2, '#cccccc'); P(x + 1 - f, 4, 1, 2, '#cccccc'); }
          break;
        case 'idle':
          for (const [x, y, s] of [[2, 8 - f, 5], [9, 2 + f, 4]]) {
            P(x, y, s, 1, '#5aa8e8'); for (let i = 1; i < s - 1; i++) P(x + s - 1 - i, y + i, 1, 1, '#5aa8e8'); P(x, y + s - 1, s, 1, '#5aa8e8');
          }
          break;
      }
    }
  });
  return b;
}

// Office background
const FLOORS = {
  wood: ['#e3c393', '#d6b281'],
  carpetBlue: ['#b9c9e8', '#aebfe0'],
  carpetGreen: ['#bfdcb4', '#b2d2a7'],
  carpetPurple: ['#d2c3ea', '#c8b8e2'],
  carpetOrange: ['#f0cfa8', '#e8c49b'],
  tileGray: ['#c9cdd6', '#bcc1cc'],
  tileTeal: ['#a8dcd6', '#9ad2cc'],
};

function officeImage() {
  const W = COLS * TILE, H = ROWS * TILE;
  const b = new Bitmap(W, H);
  const T = (tx, ty, w, h, c) => b.rect(tx * TILE, ty * TILE, w * TILE, h * TILE, c);

  // Plank floor everywhere
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const [a, c] = FLOORS.wood;
    for (let i = 0; i < 4; i++) b.rect(tx * TILE, ty * TILE + i * 8, TILE, 8, (i + tx) % 2 ? a : c);
    b.rect(tx * TILE + ((ty * 13 + tx * 7) % 24), ty * TILE + 7, 1, 1, shade(a, -0.2));
  }
  // Zone floors
  for (const z of ZONES) {
    const [x, y, w, h] = z.rect;
    const [a, c] = FLOORS[z.floor];
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const carpet = z.floor.startsWith('carpet');
      T(tx, ty, 1, 1, carpet ? a : (tx + ty) % 2 ? a : c);
      if (carpet && (tx + ty) % 2) for (let i = 0; i < 6; i++) b.px(tx * TILE + 5 + i * 4, ty * TILE + 5 + ((i * 7) % 20), c);
      else if (!carpet) { b.rect(tx * TILE, ty * TILE, TILE, 1, shade(a, -0.08)); b.rect(tx * TILE, ty * TILE, 1, TILE, shade(a, -0.08)); }
    }
    b.rect(x * TILE, y * TILE, w * TILE, 2, shade(a, -0.25));
    b.rect(x * TILE, (y + h) * TILE - 2, w * TILE, 2, shade(a, -0.25));
    b.rect(x * TILE, y * TILE, 2, h * TILE, shade(a, -0.25));
    b.rect((x + w) * TILE - 2, y * TILE, 2, h * TILE, shade(a, -0.25));
  }
  // Walls
  T(0, 0, COLS, 1, '#4a3f5c');
  T(0, 1, COLS, 1, '#8b7fa8');
  b.rect(0, 2 * TILE - 4, W, 4, '#5e5275');
  for (let tx = 2; tx < COLS - 2; tx += 5) {
    b.rect(tx * TILE + 4, 6, TILE * 2 - 8, TILE + 10, '#5e5275');
    b.rect(tx * TILE + 7, 9, TILE * 2 - 14, TILE + 4, '#bfe6ff');
    b.rect(tx * TILE + TILE - 1, 9, 2, TILE + 4, '#5e5275');
    b.rect(tx * TILE + 9, 12, 6, 2, '#ffffff');
  }
  T(0, 0, 1, ROWS, '#4a3f5c'); T(COLS - 1, 0, 1, ROWS, '#4a3f5c'); T(0, ROWS - 1, COLS, 1, '#4a3f5c');
  b.rect(TILE - 3, 0, 3, H, '#5e5275'); b.rect((COLS - 1) * TILE, 0, 3, H, '#5e5275'); b.rect(0, (ROWS - 1) * TILE, W, 3, '#5e5275');

  for (const [type, x, y, w, h] of FURNITURE) drawFurniture(b, type, x * TILE, y * TILE, w * TILE, h * TILE);
  return b;
}

function drawFurniture(b, type, x, y, w, h) {
  const R = (dx, dy, rw, rh, c) => b.rect(x + dx, y + dy, rw, rh, c);
  const shadow = () => b.rect(x + 2, y + h - 2, w - 2, 4, [0, 0, 0, 40]);
  switch (type) {
    case 'desk':
      shadow();
      b.blob(x, y + 2, w, h - 2, '#c08a5a', OUTLINE); R(1, h - 8, w - 2, 6, '#9a6a42');
      // monitor back + stand, keyboard
      b.blob(x + w / 2 - 12, y - 10, 24, 16, '#6a7084', OUTLINE); R(w / 2 - 2, 5, 4, 3, '#4a4e5c');
      R(w / 2 - 9, -7, 18, 2, '#8a90a4'); R(6, 12, 8, 6, '#ffffff'); R(7, 13, 6, 1, '#f2b544');
      R(w - 14, 10, 8, 8, '#e8875a'); R(w - 13, 11, 6, 6, '#7a4a2a');
      break;
    case 'table':
      shadow(); b.blob(x, y + 4, w, h - 4, '#d9a874', OUTLINE); R(1, h - 7, w - 2, 5, '#b8875a');
      R(w / 2 - 10, 9, 9, 10, '#fff7e0'); R(w / 2 + 1, 9, 9, 10, '#fff7e0'); R(w / 2 - 1, 8, 2, 12, '#7a4a2a');
      break;
    case 'shelf': {
      b.blob(x, y, w, h, '#8a5a36', OUTLINE);
      const colors = ['#e8875a', '#5aa8e8', '#4cc6a0', '#f2b544', '#8a7ae8', '#d9605a', '#f4a6b8'];
      for (let row = 0; row < 3; row++) {
        const sy = 4 + row * 19;
        R(3, sy, w - 6, 16, '#5e3c22');
        for (let bx = 4, k = row; bx < w - 6; k++) {
          const bw = 3 + (k % 3);
          R(bx, sy + 2 + (k % 4 === 0 ? 3 : 0), bw, 14 - (k % 4 === 0 ? 3 : 0), colors[(k * 3 + row) % colors.length]);
          bx += bw + 1;
        }
        R(2, sy + 16, w - 4, 2, '#a8744a');
      }
      break;
    }
    case 'whiteboard':
      R(10, h - 10, 3, 10, '#6a7084'); R(w - 13, h - 10, 3, 10, '#6a7084');
      b.blob(x + 2, y + 2, w - 4, h - 10, '#ffffff', OUTLINE); R(4, 4, w - 8, 2, '#e6e9f0');
      b.line(x + 14, y + 20, x + 40, y + 12, '#5aa8e8'); b.line(x + 40, y + 12, x + 60, y + 30, '#5aa8e8');
      b.ellipse(x + 90, y + 22, 12, 8, '#e8875a'); b.ellipse(x + 90, y + 22, 10, 6, '#ffffff');
      R(118, 14, 30, 2, '#4cc6a0'); R(118, 22, 22, 2, '#4cc6a0'); R(118, 30, 26, 2, '#d9605a');
      R(w / 2 - 6, h - 12, 12, 3, '#d9605a');
      break;
    case 'beanbag':
      b.ellipse(x + 16, y + 20, 14, 10, OUTLINE); b.ellipse(x + 16, y + 20, 13, 9, '#8a7ae8'); b.ellipse(x + 13, y + 16, 6, 3, '#a89af0');
      break;
    case 'meeting':
      b.rect(x + 4, y + h, w - 8, 4, [0, 0, 0, 40]);
      b.blob(x, y, w, h, '#a8744a', OUTLINE); R(2, 2, w - 4, 4, '#c08a5a'); R(1, h - 6, w - 2, 5, '#8a5a36');
      R(30, 16, 14, 18, '#ffffff'); R(32, 20, 9, 1, '#9a8f7a'); R(32, 24, 7, 1, '#9a8f7a');
      R(110, 22, 16, 12, '#ffffff'); R(150, 14, 10, 10, '#e8875a'); R(151, 15, 8, 8, '#7a4a2a');
      R(70, 18, 30, 20, '#2e3440'); R(72, 20, 26, 14, '#5aa8e8');
      break;
    case 'server':
      shadow(); b.blob(x + 2, y, w - 4, h, '#3a3f52', OUTLINE);
      for (let i = 0; i < 7; i++) { R(5, 5 + i * 8, w - 10, 6, '#2b2f3e'); R(7, 7 + i * 8, 2, 2, i % 3 ? '#4cc6a0' : '#f2b544'); R(11, 7 + i * 8, 2, 2, '#5aa8e8'); R(16, 8 + i * 8, 10, 1, '#5a6070'); }
      break;
    case 'portal':
      b.ellipse(x + w / 2, y + h - 10, w / 2, 10, [0, 0, 0, 40]);
      b.ellipse(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 2, OUTLINE);
      b.ellipse(x + w / 2, y + h / 2, w / 2 - 4, h / 2 - 4, '#3a3f52');
      b.ellipse(x + w / 2, y + h / 2, w / 2 - 10, h / 2 - 10, '#4cc6a0');
      b.ellipse(x + w / 2, y + h / 2, w / 2 - 16, h / 2 - 16, '#a8f0e0');
      b.ellipse(x + w / 2, y + h / 2, 8, 8, '#ffffff');
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.rect(x + w / 2 + Math.cos(a) * (w / 2 - 7) - 1, y + h / 2 + Math.sin(a) * (h / 2 - 7) - 1, 3, 3, '#f2c544'); }
      break;
    case 'coffee':
      b.blob(x, y + 8, w, h - 8, '#8a5a36', OUTLINE); R(2, 10, w - 4, 3, '#a8744a');
      b.blob(x + 6, y - 6, 20, 26, '#d9d2e6', OUTLINE); R(10, -2, 12, 6, '#2e3440'); R(12, 0, 3, 2, '#d9605a');
      R(12, 12, 8, 6, '#ffffff'); R(13, 13, 6, 2, '#7a4a2a');
      break;
    case 'sofa':
      b.blob(x - 2, y - 8, w + 4, 16, '#c95a5a', OUTLINE);
      b.blob(x - 4, y - 2, 10, h + 2, '#b04848', OUTLINE); b.blob(x + w - 6, y - 2, 10, h + 2, '#b04848', OUTLINE);
      b.blob(x + 4, y + 6, w - 8, h - 8, '#e07070', OUTLINE);
      break;
    case 'plant':
      b.blob(x + 9, y + 18, 14, 13, '#c0704a', OUTLINE); R(10, 19, 12, 2, '#d98a5a');
      for (const [cx, cy, r] of [[16, 10, 7], [10, 13, 5], [22, 13, 5], [16, 5, 4]]) { b.ellipse(x + cx, y + cy, r + 1, r + 1, OUTLINE); b.ellipse(x + cx, y + cy, r, r, '#4c9a5a'); }
      b.ellipse(x + 14, y + 8, 2, 2, '#6cc07a');
      break;
  }
}

const files = {};
PALETTES.forEach((pal, i) => { files[`char_${i}.png`] = characterSheet(pal); });
files['fx.png'] = fxSheet();
files['office.png'] = officeImage();
for (const [name, bmp] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), bmp.png());

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  generator: 'placeholder',
  frame: F,
  framesPerRow: 4,
  characterRows: ROWS_SPEC,
  characters: PALETTES.map((_, i) => ({ file: `char_${i}.png`, family: i < 4 ? 'claude-code' : 'codex' })),
  fx: { file: 'fx.png', size: 16, frames: 2, rows: FX },
  office: { file: 'office.png', tile: TILE, cols: COLS, rows: ROWS },
}, null, 2) + '\n');
console.log(`wrote ${Object.keys(files).length} sprites to ${OUT}`);
