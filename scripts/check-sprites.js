// Verifies the sprites match sprites/SPEC.md: every file the manifest names
// exists, character sheets and status icons have their exact grid size, and
// every prop the office map uses has art.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FURNITURE } from '../client/office-map.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets', 'sprites');
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const PROCEDURAL = new Set(['rug', 'rugRound', 'pathStone']); // painted by client/floor.js

function size(file) {
  const buf = fs.readFileSync(path.join(dir, file));
  if (buf.slice(1, 4).toString() !== 'PNG') throw new Error('not a PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

let ok = true;
function check(file, want) {
  try {
    const [w, h] = size(file);
    const good = !want || (w === want[0] && h === want[1]);
    if (!good) ok = false;
    console.log(`${good ? '✓' : '✗'} ${file}: ${w}×${h}${good ? '' : ` (expected ${want[0]}×${want[1]})`}`);
  } catch (e) {
    ok = false;
    console.log(`✗ ${file}: ${e.code === 'ENOENT' ? 'missing' : e.message}`);
  }
}

const { frame, framesPerRow, rows, list } = m.character;
for (const c of list) check(c.file, [frame * framesPerRow, frame * rows.length]);
check(m.fx.file, [m.fx.size, m.fx.size * m.fx.rows.length]);
for (const [name, p] of Object.entries(m.props)) check(p.file, [p.w, p.h]);
for (const t of Object.values(m.textures || {})) check(t.file, [t.size, t.size]);
const missing = [...new Set(FURNITURE.map(([t]) => t))].filter((t) => !m.props[t] && !PROCEDURAL.has(t));
if (missing.length) { ok = false; console.log(`✗ no art for: ${missing.join(', ')}`); }
process.exit(ok ? 0 : 1);
