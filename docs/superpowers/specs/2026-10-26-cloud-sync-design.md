# Cloud sync: a shared Agent Town on Cloudflare

## Goal

One shared office on Cloudflare. Each person runs `agent-town-client` on their own
computer. The client reads that person's Claude Code and Codex logs and pushes the
agents to the cloud office, where they show under the person's name. Many people can
push at the same time. Each person can block sessions that they do not want to share.
The local-only mode (`npm start`) stays as it is.

## Decisions

| Topic | Decision |
|-------|----------|
| Access | One team key (`TEAM_KEY`, a Wrangler secret). Clients need it to push. Viewers enter it once in the page. |
| Client | CLI (`agent-town-client`) with a local settings page. No npm dependencies. |
| Block by | Session id and folder (the whole folder tree). |
| Local mode | Kept. The client reuses the watcher, parsers and store. |
| Server | One Worker and one Durable Object (DO). State is in DO storage, not a database. |

## Parts

```
my laptop                                     Cloudflare
┌──────────────────────────────┐            ┌──────────────────────────────┐
│ agent-town-client (sync/)    │  POST      │ Worker (cloud/)               │
│  watcher → parsers → store   │ /api/push  │  serves client/ as assets     │
│  → block filter ─────────────┼──────────▶ │   ▼                           │
│  localhost page: name, URL,  │  Bearer    │ Durable Object "office"       │
│  key, block list, status     │  TEAM_KEY  │  Room: userId → snapshot      │──WS──▶ browsers
└──────────────────────────────┘            └──────────────────────────────┘
```

### `sync/` – agent-town-client

- `sync/index.js` (bin `agent-town-client`): starts a Watcher and a Store, a pusher and
  a local page on `127.0.0.1:4322`.
- Config `~/.agent-town/client.json` (`--config`, `AGENT_TOWN_CLIENT_CONFIG`):
  `user { id, name }`, `server`, `key`, `blockedSessions[]`, `blockedFolders[]`, `agents[]`
  (log folders, same as the local config). `user.id` is a random UUID made once.
- `sync/filter.js`: `shareable(agents, cfg)` drops an agent when
  - its `sessionId` is in `blockedSessions`, or
  - its `cwd` is inside a blocked folder. The match is on whole path segments
    (`/a/secret` blocks `/a/secret/x`, not `/a/secret-2`). `~` is expanded, a trailing
    `/` is removed, or
  - at least one folder is blocked and its `cwd` is still empty (fail closed).
  Subagents carry the parent's `sessionId` and `cwd`, so they follow the parent. A
  subagent whose parent is dropped is dropped too.
- Pusher: sends `{ user: {id, name}, now, agents }` to `POST <server>/api/push` with
  `Authorization: Bearer <key>`. It sends at most once every 3 s after a change (and skips a
  push when only `lastEventAt` moved), and once every 20 s as a heartbeat. The free plan
  allows about 100,000 requests a day for the whole team. On SIGINT/SIGTERM it sends `agents: []` so the person leaves
  at once. `userId` and `userName` on every agent come from the config, not the store.
- Local page: the same guards as `server/index.js` (loopback `Host`, same `Origin`, JSON
  POST only). `GET /api/config` never returns the key, only `keySet: true|false`. The page
  lists every session from the **unfiltered** store with a Share/Block switch, so a
  blocked session can be unblocked. It also edits the folder list, the name, the server URL
  and the key, and shows the last push result.

### `cloud/` – Worker and Durable Object

- `cloud/room.js`: a plain `Room` class (no Cloudflare APIs), tested with `node --test`.
  - `push(envelope, serverNow)`: validates the envelope, limits agents per user (200),
    and keeps `{ name, agents, lastPush, offset }` for the user.
  - Clock offset: `offset = serverNow - envelope.now`. `since`, `lastEventAt` and
    `history[].t` are shifted by the offset, so every person's times are in server time.
  - Ids: `id`, `parentId` and every entry of `subagents` get the prefix `<userId>:`, so ids
    from different people never collide and subagents keep their parents.
  - `userId` and `userName` on every agent are set from the envelope.
  - Only known fields of known types pass. `activity` must be one of the office zones'
    activities (else `idle`), `kind` is `main` or `subagent`, `source` is `claude-code` or
    `codex`, and strings are cut to a fixed length. Anyone with the key can push, and every
    viewer draws what is pushed.
  - `prune(serverNow)`: removes users with no push for 60 s.
  - `snapshot(serverNow)`: `{ mode: 'cloud', now, users: [{id, name}], agents }`.
  - `toJSON()` / `Room.from(json)`: the stored form.
- `cloud/worker.js`: the Worker and the `Office` DO.
  - Worker: `/api/push`, `/api/live` and `/api/mode` go to the one DO
    (`idFromName('office')`). Everything else is a static asset from `../client`.
  - Push: checks `Authorization` against `TEAM_KEY` (constant-time compare), limits the
    body to 1 MB, stores the user's entry in `ctx.storage` under `user:<id>` (at most once
    every 15 s per user; memory is always current), and schedules a broadcast.
  - Hibernation: the DO constructor loads all `user:*` entries inside
    `blockConcurrencyWhile`. A storage alarm prunes stale users (and deletes their storage
    entries) every 30 s while any user is present, and every 5 s while a viewer has not sent
    the key yet. No `setTimeout` state is needed across evictions.
  - Viewers: WebSocket with the hibernation API. The first message must be
    `{ type: 'auth', key }`. The socket's auth flag is in `serializeAttachment()`. A socket
    that is not authenticated in 5 s is closed (checked by the alarm and on each message).
    Only authenticated sockets get snapshots. Broadcasts are coalesced to one per 250 ms.
- `cloud/wrangler.toml`: `assets = { directory = "../client" }` with `run_worker_first`
  for `/api/*`, the DO binding and migration. `wrangler` is a dev dependency in
  `cloud/package.json` only. The root package stays at zero dependencies.

### `client/` – the web office

- `GET api/mode` returns `{ mode: 'local' }` from the local server and
  `{ mode: 'cloud' }` from the Worker.
- Local mode: SSE as today. Cloud mode: WebSocket `api/live`, a key prompt (the key is kept
  in `localStorage`; a wrong key asks again), and the ⚙ settings button is hidden.
- Roster: when more than one person is in the snapshot (always in cloud mode), agents are
  grouped under a header with each person's name and agent count.
- Name tags: in cloud mode the second part of the tag is `person · project`.

## Errors

- Client: a failed push (network or HTTP status) is shown on the local page and in the
  terminal, and is retried on the next tick. A 401 is shown as "wrong team key".
- Worker: 401 for a bad key, 413 for a big body, 400 for a bad envelope, 405 for a wrong
  method.

## Tests (`node --test`, no Cloudflare)

- Filter: segment match, `~` expansion, session block, subagent follows parent, empty
  `cwd` is held back while a folder block exists.
- Room: after a merge every `parentId` points at an agent in the set; a client clock 5
  minutes ahead gives correct `since`; a user silent for 60 s is removed; `Room.from(room.toJSON())`
  gives the same snapshot (the hibernation case); `userName` comes from the envelope.
- Client page: foreign `Host` gets 403, `GET /api/config` does not contain the key.
- End to end by hand: `wrangler dev`, two clients with different names, one blocked
  session.

## Out of scope

- Accounts and per-person keys.
- Publishing `agent-town-client` to npm.
- Deploying to a Cloudflare account (the user runs `wrangler login` and `wrangler deploy`).
