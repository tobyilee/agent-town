// What the office would draw differently. lastEventAt moves on every log line
// without changing the picture, so it rides along with the heartbeat only.
const signature = (agents) => JSON.stringify(agents.map(({ lastEventAt, ...a }) => a));

// Sends this person's shareable agents to the shared office: at most once per
// minGapMs after a change, and every heartbeatMs so the office knows we are
// still here (it drops people who are quiet for a minute). Pushes with nothing
// new are skipped: on Cloudflare's free plan each one counts against a daily
// request limit shared by the whole team.
export class Pusher {
  constructor({ target, envelope, fetchFn = globalThis.fetch, minGapMs = 3000, heartbeatMs = 20_000, onStatus = () => {} }) {
    this.target = target;     // () => ({ server, key })
    this.envelope = envelope; // () => ({ user, now, agents })
    this.fetchFn = fetchFn;
    this.minGapMs = minGapMs;
    this.heartbeatMs = heartbeatMs;
    this.onStatus = onStatus;
    this.status = { state: 'off', error: 'Set the office URL and the team key' };
    this.last = 0;
    this.timer = null;
    this.heartbeat = null;
    this.sending = false;
    this.again = false;
    this.force = false;
    this.sentSig = null;
  }

  start() {
    this.heartbeat = setInterval(() => this.changed(true), this.heartbeatMs);
    this.changed(true);
  }

  stop() {
    clearInterval(this.heartbeat);
    clearTimeout(this.timer);
    this.timer = null;
  }

  // force: send even if nothing changed (the heartbeat, new settings).
  changed(force = false) {
    this.force ||= force;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.send(); }, Math.max(0, this.last + this.minGapMs - Date.now()));
  }

  setStatus(s) {
    const prev = this.status;
    this.status = { ...s, at: Date.now() };
    if (prev.state !== s.state || prev.error !== s.error) this.onStatus(this.status, prev);
  }

  async post(body, timeoutMs = 10_000) {
    const { server, key } = this.target();
    const res = await this.fetchFn(`${server}/api/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let reply = {};
    try { reply = await res.json(); } catch {}
    if (!res.ok) throw new Error(res.status === 401 ? 'wrong team key' : reply.error || `the office answered ${res.status}`);
    return reply;
  }

  async send() {
    if (this.sending) { this.again = true; return; }
    const { server, key } = this.target();
    if (!server || !key) return this.setStatus({ state: 'off', error: 'Set the office URL and the team key' });
    const env = this.envelope();
    const sig = signature(env.agents);
    if (!this.force && sig === this.sentSig && this.status.state === 'ok') return;
    this.force = false;
    this.sending = true;
    this.last = Date.now();
    try {
      const reply = await this.post(env);
      this.sentSig = sig;
      this.setStatus({ state: 'ok', shared: env.agents.length, users: reply.users });
    } catch (e) {
      this.sentSig = null;
      this.setStatus({ state: 'error', error: e.name === 'TimeoutError' ? 'the office did not answer' : e.cause?.code || e.message });
    } finally {
      this.sending = false;
      if (this.again) { this.again = false; this.changed(); }
    }
  }

  // Tells the office we are gone, so our agents leave at once.
  async leave() {
    this.stop();
    const { server, key } = this.target();
    if (!server || !key) return;
    try { await this.post({ user: this.envelope().user, leave: true }, 3000); } catch {}
  }
}
