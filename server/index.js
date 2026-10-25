#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Watcher } from './watcher.js';
import { AGENT_TYPES, configPath, loadConfig, normalize, saveConfig } from './config.js';
import { startDemo } from './demo.js';

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };

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
    let tooBig = false;
    req.on('data', (c) => { if (!tooBig) s += c; if (s.length > 1e6) tooBig = true; });
    req.on('end', () => (tooBig ? reject(Object.assign(new Error('request body too large'), { status: 413 })) : resolve(s)));
    req.on('error', reject);
  });
}

// The server listens on 127.0.0.1 only, but a web page in the browser can still
// reach it. Two guards keep other sites out:
// - Host must be a loopback name. A DNS-rebinding page arrives with its own
//   domain in Host, so it cannot read the office state (prompts, file paths).
// - A settings change must come from this page itself: no foreign Origin, and a
//   JSON body, which a cross-site form or simple fetch cannot send without a
//   CORS preflight that this server never answers.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function localHost(req) {
  const host = req.headers.host || '';
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK.has(name.toLowerCase());
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

async function handle(req, res) {
  if (!localHost(req)) return json(res, 403, { error: 'Agent Town only answers on localhost' });
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
      if (!sameOrigin(req)) return json(res, 403, { error: 'settings can only be changed from the Agent Town page' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'send settings as application/json' });
      try {
        const body = JSON.parse(await readBody(req));
        if (!body || typeof body !== 'object') throw new Error('settings must be a JSON object');
        cfg = normalize({ ...cfg, agents: body.agents ?? cfg.agents, user: { ...cfg.user, ...(body.user || {}) } });
        store.userName = cfg.user.name;
        saveConfig(cfgFile, cfg);
        await startWatcher();
        return json(res, 200, { config: cfg });
      } catch (e) {
        return json(res, e.status || 400, { error: String(e.message || e) });
      }
    }
    return json(res, 405, { error: 'use GET or POST' });
  }

  let rel;
  try {
    rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400);
    return res.end('bad request');
  }
  const file = path.join(CLIENT_DIR, rel);
  if (!file.startsWith(CLIENT_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// One bad request must never take the server down.
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('request failed:', e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

await startWatcher();
server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`Agent Town is open at http://localhost:${cfg.port}${demo ? '  (demo mode)' : ''}`);
});
