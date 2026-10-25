import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_TYPES = {
  'claude-code': { label: 'Claude Code', defaultPath: () => path.join(os.homedir(), '.claude', 'projects') },
  codex: { label: 'Codex CLI', defaultPath: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions') },
};

export function defaultConfig() {
  return {
    port: 4321,
    user: { id: 'local', name: os.userInfo().username },
    agents: Object.entries(AGENT_TYPES).map(([type, t]) => ({ type, enabled: true, path: t.defaultPath() })),
    activeWindowMinutes: 60,
    idleAfterSeconds: 90,
    goneAfterMinutes: 30,
  };
}

export function configPath(argv = process.argv) {
  const i = argv.indexOf('--config');
  if (i > -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return process.env.AGENT_TOWN_CONFIG || path.join(os.homedir(), '.agent-town', 'config.json');
}

export function expandHome(p) {
  return p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function loadConfig(file) {
  const base = defaultConfig();
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return normalize({ ...base, ...user, user: { ...base.user, ...(user.user || {}) } });
}

export function normalize(cfg) {
  const agents = Array.isArray(cfg.agents) ? cfg.agents : [];
  cfg.agents = agents
    .filter((a) => AGENT_TYPES[a.type])
    .map((a) => ({ type: a.type, enabled: a.enabled !== false, path: expandHome(a.path || AGENT_TYPES[a.type].defaultPath()) }));
  return cfg;
}

export function saveConfig(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}
