import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Starts a real agent-town-client (demo mode, temporary config) that pushes to
// a fake office on this computer, and checks what reaches the office.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 40000 + Math.floor(Math.random() * 20000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-town-sync-'));
const cfgFile = path.join(dir, 'client.json');
const KEY = 'test-key-123';
const pushes = [];
let office, officeUrl, client;

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

const settings = (body) => request('POST', '/api/config', { headers: { origin: `http://localhost:${port}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const block = (body) => request('POST', '/api/block', { headers: { origin: `http://localhost:${port}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = async () => JSON.parse((await request('GET', '/api/state')).body);

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  office = http.createServer((req, res) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401); return res.end('{}'); }
      pushes.push(JSON.parse(s));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, users: 1 }));
    });
  });
  await new Promise((r) => office.listen(0, '127.0.0.1', r));
  officeUrl = `http://127.0.0.1:${office.address().port}`;
  client = spawn(process.execPath, [path.join(ROOT, 'sync/index.js'), '--demo', '--port', String(port), '--config', cfgFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    client.stdout.on('data', (d) => { if (String(d).includes('settings: http')) resolve(); });
    client.on('exit', (code) => reject(new Error(`client exited with ${code}`)));
  });
});

after(() => {
  client.kill('SIGKILL');
  office.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('client: the first run saves a stable user id and keeps the file private', () => {
  const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.match(saved.user.id, /^[0-9a-f-]{36}$/);
  assert.equal(fs.statSync(cfgFile).mode & 0o077, 0);
});

test('client: a foreign Host or another site cannot read or change it', async () => {
  assert.equal((await request('GET', '/api/state', { headers: { host: 'attacker.example' } })).status, 403);
  const evil = await request('POST', '/api/config', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ server: 'https://evil.example' }) });
  assert.equal(evil.status, 403);
  const simple = await request('POST', '/api/block', { headers: { 'content-type': 'text/plain' }, body: '{"sessionId":"x","blocked":true}' });
  assert.equal(simple.status, 415);
});

test('client: a plain http office URL is refused unless it is on this computer', async () => {
  assert.equal((await settings({ server: 'http://office.example.com' })).status, 400);
});

test('client: the team key is saved but never sent back to the page', async () => {
  assert.equal((await settings({ user: { name: 'Toby' }, server: officeUrl, key: KEY })).status, 200);
  for (const p of ['/api/state', '/api/config']) {
    const r = await request('GET', p);
    assert.doesNotMatch(r.body, new RegExp(KEY));
    assert.equal(JSON.parse(r.body).config.keySet, true);
  }
  // An empty key field keeps the saved key.
  assert.equal((await settings({ user: { name: 'Toby' }, key: '' })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).key, KEY);
});

test('client: shared sessions reach the office under my name, blocked ones never do', async () => {
  const { victim, other } = await until(async () => {
    const st = await state();
    const v = st.sessions.find((x) => x.cwd && x.source === 'claude-code');
    const o = v && st.sessions.find((x) => x.cwd && x.cwd !== v.cwd);
    return o && { victim: v, other: o };
  });
  assert.equal((await block({ sessionId: victim.sessionId, blocked: true })).status, 200);
  assert.equal((await settings({ blockedFolders: [other.cwd] })).status, 200);
  const n = pushes.length;
  await until(() => pushes.length > n + 2);
  assert.ok(pushes.slice(n + 1).some((p) => p.agents.length), 'the other sessions are still shared');
  for (const p of pushes.slice(n + 1)) {
    assert.equal(p.user.name, 'Toby');
    for (const a of p.agents) {
      assert.equal(a.userName, 'Toby');
      assert.notEqual(a.sessionId, victim.sessionId);
      assert.notEqual(a.cwd, other.cwd);
      assert.ok(a.cwd, 'an agent with no folder must be held back while a folder is blocked');
    }
  }
  // The page still lists the blocked session, so it can be unblocked.
  const after = await state();
  assert.equal(after.sessions.find((x) => x.sessionId === victim.sessionId).reason, 'session');
});

test('client: stopping it tells the office I left', async () => {
  client.kill('SIGTERM');
  await until(() => pushes.some((p) => p.leave === true));
});
