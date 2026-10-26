import fs from 'node:fs';
import path from 'node:path';

// Small HTTP helpers shared by the local office server and agent-town-client's
// settings page. Both listen on 127.0.0.1 only and use the same guards.

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };

export function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    let tooBig = false;
    req.on('data', (c) => { if (!tooBig) s += c; if (s.length > 1e6) tooBig = true; });
    req.on('end', () => (tooBig ? reject(Object.assign(new Error('request body too large'), { status: 413 })) : resolve(s)));
    req.on('error', reject);
  });
}

// A web page in the browser can still reach a server on 127.0.0.1. Two guards
// keep other sites out:
// - Host must be a loopback name. A DNS-rebinding page arrives with its own
//   domain in Host, so it cannot read the state (prompts, file paths).
// - A settings change must come from the page itself: no foreign Origin, and a
//   JSON body, which a cross-site form or simple fetch cannot send without a
//   CORS preflight that these servers never answer.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function localHost(req) {
  const host = req.headers.host || '';
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK.has(name.toLowerCase());
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

// Checks the guards for a settings change and returns its parsed JSON body;
// throws an Error with .status otherwise.
export async function readSettings(req, page = 'Agent Town') {
  if (!sameOrigin(req)) throw Object.assign(new Error(`settings can only be changed from the ${page} page`), { status: 403 });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('send settings as application/json'), { status: 415 });
  const body = JSON.parse(await readBody(req));
  if (!body || typeof body !== 'object') throw new Error('settings must be a JSON object');
  return body;
}

export function serveStatic(res, dir, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400);
    return res.end('bad request');
  }
  const file = path.join(dir, rel);
  if (!file.startsWith(dir + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}
