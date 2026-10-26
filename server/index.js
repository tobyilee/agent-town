#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, localHost, readSettings, serveStatic } from './http.js';
import { Store } from './store.js';
import { Watcher } from './watcher.js';
import { AGENT_TYPES, configPath, loadConfig, normalize, saveConfig } from './config.js';
import { startDemo } from './demo.js';

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');

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

async function handle(req, res) {
  if (!localHost(req)) return json(res, 403, { error: 'Agent Town only answers on localhost' });
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/mode') return json(res, 200, { mode: 'local' });
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
        const body = await readSettings(req);
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

  serveStatic(res, CLIENT_DIR, url.pathname);
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
