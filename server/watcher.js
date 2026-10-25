import fs from 'node:fs/promises';
import path from 'node:path';
import { ClaudeSession, claudeFileInfo } from './parsers/claude.js';
import { CodexSession, codexSessionId } from './parsers/codex.js';

const MAX_DEPTH = 6;

async function listJsonl(dir, depth = 0, out = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < MAX_DEPTH) await listJsonl(p, depth + 1, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// Polls the configured log directories, tails every recently-modified JSONL
// file and feeds each new line to the matching session parser. Polling (rather
// than fs.watch) behaves the same on macOS, Linux, WSL and network drives.
export class Watcher {
  constructor(store, { sources, pollMs = 750, scanMs = 3000, activeWindowMs = 60 * 60_000, backfillBytes = 512 * 1024 }) {
    this.store = store;
    this.sources = sources;
    this.pollMs = pollMs;
    this.scanMs = scanMs;
    this.activeWindowMs = activeWindowMs;
    this.backfillBytes = backfillBytes;
    this.files = new Map();    // path -> { type, offset, partial }
    this.sessions = new Map(); // key -> session parser
    this.timers = [];
    this.busy = false;
  }

  async start() {
    await this.scan();
    await this.poll();
    this.timers.push(setInterval(() => this.scan(), this.scanMs));
    this.timers.push(setInterval(() => this.poll(), this.pollMs));
    this.timers.push(setInterval(() => this.store.tick(), 5000));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  async scan() {
    const now = Date.now();
    for (const src of this.sources) {
      for (const file of await listJsonl(src.path)) {
        if (this.files.has(file)) continue;
        let st;
        try { st = await fs.stat(file); } catch { continue; }
        if (now - st.mtimeMs > this.activeWindowMs) continue;
        const offset = Math.max(0, st.size - this.backfillBytes);
        this.files.set(file, { type: src.type, offset, partial: '', skipFirst: offset > 0 });
      }
    }
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const [file, f] of this.files) await this.readNew(file, f);
    } finally {
      this.busy = false;
    }
  }

  async readNew(file, f) {
    let st;
    try { st = await fs.stat(file); } catch { this.files.delete(file); return; }
    if (st.size < f.offset) { f.offset = 0; f.partial = ''; }
    if (st.size === f.offset) return;
    const fh = await fs.open(file, 'r');
    try {
      const len = st.size - f.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, f.offset);
      f.offset = st.size;
      let text = f.partial + buf.toString('utf8');
      const lines = text.split('\n');
      f.partial = lines.pop();
      if (f.skipFirst) { lines.shift(); f.skipFirst = false; }
      for (const line of lines) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        this.dispatch(file, f.type, rec);
      }
      // Right away, before any snapshot goes out: a session whose backfilled
      // lines are already older than goneAfter never shows up after a restart.
      this.store.tick();
    } finally {
      await fh.close();
    }
  }

  dispatch(file, type, rec) {
    if (type === 'claude-code') {
      const { sessionId, subFile } = claudeFileInfo(file);
      const key = `claude-code:${sessionId}`;
      let s = this.sessions.get(key);
      if (!s || !this.store.get(key)) this.sessions.set(key, (s = new ClaudeSession(this.store, sessionId, Date.parse(rec.timestamp) || Date.now())));
      s.handle(rec, subFile);
    } else if (type === 'codex') {
      const sessionId = codexSessionId(file);
      const key = `codex:${sessionId}`;
      let s = this.sessions.get(key);
      if (!s || !this.store.get(key)) this.sessions.set(key, (s = new CodexSession(this.store, sessionId, Date.parse(rec.timestamp) || Date.now())));
      s.handle(rec);
    }
  }
}
