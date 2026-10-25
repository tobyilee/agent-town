import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Starts a real server (demo mode, temporary config) and attacks it over HTTP.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 40000 + Math.floor(Math.random() * 20000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-town-server-'));
const cfgFile = path.join(dir, 'config.json');
let server;

function request(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const savedName = () => (fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')).user.name : null);

before(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js'), '--demo', '--port', String(port), '--config', cfgFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('is open at')) resolve(); });
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('server: the page and the state are served on localhost', async () => {
  assert.equal((await request('GET', '/')).status, 200);
  assert.equal((await request('GET', '/api/state')).status, 200);
  assert.equal((await request('GET', '/api/state', { headers: { host: `127.0.0.1:${port}` } })).status, 200);
});

test('server: a foreign Host (DNS rebinding) cannot read the state', async () => {
  const r = await request('GET', '/api/state', { headers: { host: `attacker.example:${port}` } });
  assert.equal(r.status, 403);
  assert.doesNotMatch(r.body, /agents/);
  assert.equal((await request('GET', '/api/events', { headers: { host: 'attacker.example' } })).status, 403);
});

test('server: another site cannot change the settings', async () => {
  const before = savedName();
  const evil = await request('POST', '/api/config', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ user: { name: 'pwned' } }),
  });
  assert.equal(evil.status, 403);
  // A cross-site form or "simple" fetch can only send text/plain and the like.
  const simple = await request('POST', '/api/config', { headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ user: { name: 'pwned' } }) });
  assert.equal(simple.status, 415);
  assert.equal(savedName(), before);
});

test('server: the page itself can still change the settings', async () => {
  const r = await request('POST', '/api/config', {
    headers: { origin: `http://localhost:${port}`, 'content-type': 'application/json' },
    body: JSON.stringify({ user: { name: 'Tester' } }),
  });
  assert.equal(r.status, 200);
  assert.equal(savedName(), 'Tester');
});

test('server: a malformed URL is rejected and the server keeps running', async () => {
  assert.equal((await request('GET', '/%E0%A4%A')).status, 400);
  assert.equal((await request('GET', '/..%2f..%2fpackage.json')).status, 403);
  assert.equal(server.exitCode, null);
  assert.equal((await request('GET', '/api/state')).status, 200);
});
