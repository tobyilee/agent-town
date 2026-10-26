import path from 'node:path';
import { expandHome } from '../server/config.js';

// Decides which agents leave this computer. Blocked agents are never pushed,
// so the cloud office never sees them.

function clean(p) {
  const abs = path.resolve(expandHome(String(p).trim()));
  return abs.length > 1 ? abs.replace(/[\\/]+$/, '') : abs;
}

// Whole path parts only: /work/secret holds /work/secret/api, not /work/secret-2.
export function inFolder(cwd, folder) {
  const c = clean(cwd), f = clean(folder);
  return c === f || c.startsWith(f.endsWith(path.sep) ? f : f + path.sep);
}

// null when the agent may be shared, otherwise why not.
export function blockReason(a, cfg) {
  if (cfg.blockedSessions.includes(a.sessionId)) return 'session';
  const folders = cfg.blockedFolders.filter((f) => String(f).trim());
  if (!folders.length) return null;
  // Fail closed: until we know where it runs, it may be in a blocked folder.
  if (!a.cwd) return 'no-folder-yet';
  return folders.some((f) => inFolder(a.cwd, f)) ? 'folder' : null;
}

export function shareable(agents, cfg) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const ok = (a) => !blockReason(a, cfg) && (!a.parentId || (byId.has(a.parentId) && ok(byId.get(a.parentId))));
  return agents.filter(ok).map((a) => ({ ...a, userId: cfg.user.id, userName: cfg.user.name }));
}
