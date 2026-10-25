import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Watcher } from './watcher.js';
import { AGENT_TYPES, configPath, loadConfig, normalize, saveConfig } from './config.js';
import { startDemo } from './demo.js';

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

const demo = process.argv.includes('--demo');
const cfgFile = configPath();
let cfg = loadConfig(cfgFile);
const portArg = process.argv.indexOf('--port');
if (portArg > -1) cfg.port = Number(process.argv[portArg + 1]);
const demoSources = demo ? startDemo() : null;

const store = new Store({
  userId: cfg.user.id,
  userName: cfg.user.name,
  idleAfterMs: cfg.idleAfterSeconds * 1000,
  restAfterMs: cfg.restAfterMinutes * 60_000,
  goneAfterMs: cfg.goneAfterMinutes * 60_000,
});

let watcher;
async function startWatcher() {
  watcher?.stop();
  const sources = (demoSources || cfg.agents).filter((a) => a.enabled);
  watcher = new Watcher(store, { sources, activeWindowMs: cfg.activeWindowMinutes * 60_000 });
  // Drop agents from sources that were just turned off.
  for (const a of [...store.agents.values()]) if (!sources.some((s) => s.type === a.source)) store.agents.delete(a.id);
  await watcher.start();
  console.log(`watching: ${sources.map((s) => `${s.type} (${s.path})`).join(', ') || 'nothing'}`);
}

// Server-sent events: one snapshot per change, coalesced.
const clients = new Set();
let pending = null;
store.on('change', () => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const data = `data: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  }, 150);
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20_000);

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') return json(res, 200, store.snapshot());
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/config') {
    if (req.method === 'GET') {
      return json(res, 200, { config: cfg, types: Object.fromEntries(Object.entries(AGENT_TYPES).map(([k, v]) => [k, v.label])), demo, file: cfgFile });
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        cfg = normalize({ ...cfg, agents: body.agents ?? cfg.agents, user: { ...cfg.user, ...(body.user || {}) } });
        store.userName = cfg.user.name;
        saveConfig(cfgFile, cfg);
        await startWatcher();
        return json(res, 200, { config: cfg });
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
    }
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(CLIENT_DIR, rel);
  if (!file.startsWith(CLIENT_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

await startWatcher();
server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`Agent Town is open at http://localhost:${cfg.port}${demo ? '  (demo mode)' : ''}`);
});
