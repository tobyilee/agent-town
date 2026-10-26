import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultConfig, normalize, saveConfig } from '../server/config.js';

// agent-town-client's settings: who you are, where the shared office is, the
// team key, which logs to read, and what never leaves this computer.

export function clientConfigPath(argv = process.argv) {
  const i = argv.indexOf('--config');
  if (i > -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return process.env.AGENT_TOWN_CLIENT_CONFIG || path.join(os.homedir(), '.agent-town', 'client.json');
}

export function defaultClientConfig() {
  const office = defaultConfig();
  return {
    port: 4322,
    server: '',
    key: '',
    user: { id: randomUUID(), name: office.user.name },
    agents: office.agents,
    blockedSessions: [],
    blockedFolders: [],
    activeWindowMinutes: office.activeWindowMinutes,
    idleAfterSeconds: office.idleAfterSeconds,
    restAfterMinutes: office.restAfterMinutes,
    goneAfterMinutes: office.goneAfterMinutes,
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// '' or the office URL without a trailing slash. Plain http only for a server
// on this computer (wrangler dev): anywhere else the team key would travel in
// the clear.
export function checkServer(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw new Error(`"${s}" is not a URL`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) {
    throw new Error('the office URL must start with https:// (http:// only for localhost)');
  }
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

const strings = (list) => [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean))];

export function normalizeClient(cfg) {
  normalize(cfg);
  cfg.server = checkServer(cfg.server);
  cfg.key = typeof cfg.key === 'string' ? cfg.key.trim() : '';
  cfg.user = { id: cfg.user.id, name: String(cfg.user.name || '').trim().slice(0, 40) || os.userInfo().username };
  cfg.blockedSessions = strings(cfg.blockedSessions);
  cfg.blockedFolders = strings(cfg.blockedFolders);
  return cfg;
}

// The first run writes the file at once, so the random user id stays the same.
export function loadClientConfig(file) {
  const base = defaultClientConfig();
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const cfg = { ...base, ...saved, user: { ...base.user, ...(saved.user || {}) } };
  try { normalizeClient(cfg); } catch (e) {
    console.warn(`ignoring the saved server URL: ${e.message}`);
    cfg.server = '';
    normalizeClient(cfg);
  }
  if (!saved.user?.id) saveClientConfig(file, cfg);
  return cfg;
}

export function saveClientConfig(file, cfg) {
  saveConfig(file, cfg);
  try { fs.chmodSync(file, 0o600); } catch {} // it holds the team key
}
