// Verifies the sprite files match sprites/SPEC.md (exact PNG dimensions).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'assets', 'sprites');
const expected = { 'fx.png': [32, 160], 'office.png': [1088, 768] };
for (let i = 0; i < 8; i++) expected[`char_${i}.png`] = [128, 224];

let ok = true;
for (const [file, [w, h]] of Object.entries(expected)) {
  let buf;
  try { buf = fs.readFileSync(path.join(dir, file)); } catch { console.log(`✗ ${file}: missing`); ok = false; continue; }
  const isPng = buf.slice(1, 4).toString() === 'PNG';
  const [gw, gh] = isPng ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : [0, 0];
  const good = isPng && gw === w && gh === h;
  console.log(`${good ? '✓' : '✗'} ${file}: ${isPng ? `${gw}×${gh}` : 'not a PNG'}${good ? '' : ` (expected ${w}×${h})`}`);
  ok &&= good;
}
process.exit(ok ? 0 : 1);
