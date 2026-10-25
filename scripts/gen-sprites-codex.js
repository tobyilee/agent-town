// Draws the art with Codex headless image generation, then fits it to the grid
// the client expects (scripts/fit-sprites.py).
//
//   npm run sprites:codex                      # draw whatever is missing in sprites/raw/, then fit
//   npm run sprites:codex -- desk char_3       # redraw just these images
//   npm run sprites:codex -- --all             # redraw everything
//   npm run sprites:codex -- --fit             # only fit the raw images already there
//
// Needs the Codex CLI signed in with the image_generation feature, and python3
// (Pillow and numpy are installed into sprites/.venv on first run). Env: CODEX_WORKERS (default 6),
// CODEX_FLAGS (extra flags for `codex exec`).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'sprites', 'raw');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'sprites', 'assets.json'), 'utf8'));
const args = process.argv.slice(2);

const jobs = [
  ...spec.character.list.map((c) => ({ name: c.file, prompt: `${spec.character.sheet} The character: ${c.look}. Style: ${spec.style}. ${spec.background}` })),
  ...Object.entries(spec.texture.list).map(([name, look]) => ({ name: `tex_${name}`, prompt: `${spec.texture.prompt} The floor: ${look}.` })),
  { name: 'fx', prompt:`${spec.fx.prompt} Style: ${spec.style}, except that the letters on the terminal and Zz icons are allowed. ${spec.background}` },
  ...Object.entries(spec.props).map(([name, p]) => ({
    name,
    prompt: `A single game prop, centered, filling most of the image: ${p.prompt}. Style: ${spec.style}. ${spec.background}`,
  })),
];

function pick() {
  const names = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--fit')) return [];
  if (names.length) {
    const unknown = names.filter((n) => !jobs.some((j) => j.name === n));
    if (unknown.length) throw new Error(`unknown image(s): ${unknown.join(', ')}. Known: ${jobs.map((j) => j.name).join(', ')}`);
    return jobs.filter((j) => names.includes(j.name));
  }
  if (args.includes('--all')) return jobs;
  return jobs.filter((j) => !fs.existsSync(path.join(RAW, `${j.name}.png`)));
}

function worker(i, list) {
  const prompt = [
    'You are drawing game art for Agent Town. Make one image per item below with your image generation tool.',
    'Use each prompt exactly as written. After each image, copy the PNG file the tool produced to the given path (overwrite it).',
    'Do not write code, do not edit any other file, do not post-process the images.',
    '',
    ...list.map((j) => `- Save to sprites/raw/${j.name}.png\n  Prompt: ${j.prompt}`),
  ].join('\n');
  const log = fs.createWriteStream(path.join(RAW, 'logs', `worker-${i}.log`));
  const extra = (process.env.CODEX_FLAGS || '').split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    const p = spawn('codex', ['exec', '-s', 'workspace-write', ...extra, prompt], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(log);
    p.stderr.pipe(log);
    p.on('close', (code) => resolve(code));
  });
}

async function draw(todo) {
  if (!todo.length) return;
  if (spawnSync('codex', ['--version']).status !== 0) throw new Error('codex CLI not found. Install it with: npm i -g @openai/codex');
  fs.mkdirSync(path.join(RAW, 'logs'), { recursive: true });
  const n = Math.min(todo.length, Number(process.env.CODEX_WORKERS) || 6);
  const groups = Array.from({ length: n }, (_, i) => todo.filter((_, k) => k % n === i));
  console.log(`▶ codex: drawing ${todo.length} image(s) with ${n} worker(s); logs in sprites/raw/logs/`);
  const started = todo.map((j) => [j.name, fs.statSync(path.join(RAW, `${j.name}.png`), { throwIfNoEntry: false })?.mtimeMs || 0]);
  await Promise.all(groups.map((g, i) => worker(i, g)));
  const missing = started.filter(([name, before]) => (fs.statSync(path.join(RAW, `${name}.png`), { throwIfNoEntry: false })?.mtimeMs || 0) <= before);
  if (missing.length) console.log(`✗ not drawn: ${missing.map(([n]) => n).join(', ')} (run again to retry)`);
}

function fit() {
  const venv = path.join(ROOT, 'sprites', '.venv');
  const py = path.join(venv, 'bin', 'python');
  if (!fs.existsSync(py)) {
    console.log('▶ creating sprites/.venv with Pillow and numpy');
    const ok = spawnSync('python3', ['-m', 'venv', venv], { stdio: 'inherit' }).status === 0
      && spawnSync(py, ['-m', 'pip', 'install', '-q', 'pillow', 'numpy'], { stdio: 'inherit' }).status === 0;
    if (!ok) throw new Error('could not set up Python with Pillow and numpy');
  }
  const r = spawnSync(py, [path.join(ROOT, 'scripts', 'fit-sprites.py')], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

fs.mkdirSync(RAW, { recursive: true });
await draw(pick());
fit();
