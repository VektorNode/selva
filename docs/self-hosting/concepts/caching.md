---
title: Caching
order: 5
published: true
description: 'Where Selva caches (browser, server, and Rhino.Compute), what invalidates each cache, and how to tell one is working.'
---

# Caching

Solving a Grasshopper definition is the expensive part of Selva. Caches avoid repeating the solve,
re-uploading the definition, and re-reading it from storage.

## Overview

A request checks each layer in turn and stops at the first hit.

| Cache            | Runs in         | Skips                              | Configurable |
| ---------------- | --------------- | ---------------------------------- | ------------ |
| Recent results   | Browser         | the whole round-trip               | no           |
| Solve cache      | Selva server    | the network call **and** the solve | yes          |
| Definition cache | Selva server    | reading the `.gh` from storage     | yes          |
| Pointer reuse    | Selva ↔ Compute | re-uploading the `.gh`             | yes          |
| `cachesolve`     | Rhino.Compute   | the solve                          | yes          |

Other mechanisms need no configuration: see [Caches you don't configure](#caches-you-dont-configure).

---

## Why you rarely need to clear a cache

Publishing a definition gives it a new version id, and entries key on that id. A new version lands
under keys nothing has used, so nothing needs clearing. Old entries age out, and a rollback re-hits
the old ones.

Only two caches discard entries on purpose: recent browser results clear when you switch definition,
and the warm-client cache drops a server when its URL or API key changes.

Two situations leave entries lingering. Neither causes wrong output.

1. **You delete a definition.** Its definition-cache entries sit in memory until the byte budget
   evicts them. Nothing can reach them.
2. **You upgrade Rhino in place on an existing compute server.** The solve cache lives per warm
   compute client, so results from the old Rhino survive.

### Clearing one anyway

`/admin/compute` has a **Clear** button on the solve-cache and definition-cache panels. It empties
that cache on the Selva instance serving the request. Behind a load balancer the other instances keep
theirs, so a fleet-wide clear means a restart.

Use it in the two cases above, or when a definition reads outside its inputs (see the solve cache
warning below). Clearing costs a re-solve or a storage re-read, never correctness.

The per-server **Purge** button is separate: it clears Rhino.Compute's own `cachesolve`. Selva's solve
cache sits in front of it, so purging alone won't give a fresh solve.

---

## The result caches, one at a time

### Recent results (browser)

Holds the last **16** solve results, looked up by input values. Dragging a slider back to a value you
already solved returns instantly with no request.

- Per browser tab. Gone on reload.
- Cleared when the active definition changes. Not configurable.

### Solve cache (Selva server)

Returns the stored result when the same definition with the same inputs was already solved on this
process, without calling Rhino.Compute.

- Lives in one process's memory. Lost on restart, not shared across instances.
- **Limit:** `COMPUTE_SOLVE_CACHE_MB`, default 256 MB. It counts each result's wire size; the gzipped
  copy kept beside it for browsers comes on top.
- **No timer expiry.** When the budget is exceeded, the least recently used entries go first. The same
  definition and inputs always give the same result, so a kept entry can't go stale.
- Results that carry Grasshopper errors are cached too: a definition that raises errors by design
  raises them every time.
- **Warning: definitions that read outside their inputs** (a live URL, a database, the clock). Their
  output isn't a function of their inputs, so a cached result can be wrong. Nothing detects this.
  Clear the cache or restart.
- **Warning: the budget is per compute server**, and Selva keeps up to 16 warm. The worst case is
  `256 MB × 16`. Lower `COMPUTE_SOLVE_CACHE_MB` if you run several compute servers on a small host.

### Definition cache (Selva server)

Holds `.gh` bytes so a re-solve doesn't re-read a multi-MB file from storage. With pointer reuse, a
warm re-solve moves no definition bytes. Limit: `COMPUTE_DEFINITION_CACHE_MB`, default 256 MB.

A definition reaches a solve from one of two sources, and only one can go stale:

| Source                           | Keyed on                  | Re-read after | Why                                      |
| -------------------------------- | ------------------------- | ------------- | ---------------------------------------- |
| **Uploaded** to Selva            | version id (never reused) | never         | a published version's bytes never change |
| **Remote URL** (`definitionUrl`) | the URL                   | 5 min         | whoever owns the URL can swap the file   |

Remote bytes live in a separate in-process map of up to 50 entries, outside the byte budget, so
`COMPUTE_DEFINITION_CACHE_MB=0` doesn't turn them off. The 5-minute bound is fixed and applies only
to them.

### Pointer reuse (how the definition is sent)

Not a result cache. Selva uploads the `.gh` once, gets a key back, and sends only the key afterwards.

- The only cache that helps while inputs keep changing, such as slider scrubbing on a large definition.
- Doesn't skip the solve, only the upload.
- If the server forgot the key, Selva re-uploads automatically.
- Only on a server that reports a forgotten key correctly. Selva turns pointer reuse on when the
  server answers `/limits` (the VektorNode fork does) and off otherwise, because elsewhere a
  forgotten key could return empty geometry.

### `cachesolve` (Rhino.Compute)

Asks the compute server to remember results, keyed on definition + inputs.

- Lives on the compute server, so it survives Selva restarts and is shared by every Selva instance
  using that server. It is the one tier that survives an instance going cold.
- Still costs a network round-trip. Its stored results use memory on the compute box: turn it off
  with `COMPUTE_SERVER_CACHESOLVE=false` if that box is constrained and outputs are large.
- **Purge** at `/admin/compute`. One `POST /cache/purge` reaches only one of the server's Rhino child
  processes, so Selva loops the call across the round-robin pool and reports how many it reached. If
  it can't be sure it covered every child, the result is labelled best-effort.

---

## Caches you don't configure

None has settings. The first four can't serve stale content.

- **Warm-client cache** (Selva server, up to 16 servers) keeps a connected client per compute server
  instead of reconnecting each solve. It drops a server when you change its URL or key.
- **Single-flight** (Selva server). Identical solves arriving together run once and share the result,
  so a popular public definition doesn't send compute a hundred copies of the same work after a
  deploy. Nothing is stored. It runs for every solve, which matters most when the solve cache is off.
- **Finished geometry** (browser, 256 MB). The viewer keeps parsed geometry keyed on the exact
  geometry bytes. A re-solve that only changed materials, names or layers sends the same bytes and
  skips most of the parse.
- **Edge extraction** (browser). Edges are computed once per identical mesh in a solve, and the result
  goes with the geometry arrays it came from, so a cache hit above reuses it too.

Two more have no settings but can lag behind a change, each by a fixed window and only on the
instance that didn't make it:

- **Compute server choice** (Selva server, 30 seconds per caller). Every solve and describe looks up
  which compute server to use. Saving `/admin/compute` or an org's compute settings clears it on the
  instance that saved; another instance picks the change up within 30 seconds.
- **API keys** (Selva server, 60 seconds per key). A key and its owner are checked once a minute
  instead of on every request, which matters for an agent making many calls. Revoking a key,
  removing its owner from the org, or disabling or deleting the owner clears it on the instance that
  did it at once; another instance stops accepting the key within 60 seconds. An expired key is never
  accepted.

---

## Where to change settings

Server-side, in [`packages/selva/.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example) (copy to `.env`).
Defaults and parsing live in [`packages/server/src/compute/limits.ts`](https://github.com/VektorNode/selva/blob/main/packages/server/src/compute/limits.ts).
Restart the Selva server after editing. The defaults suit most deployments; the settings exist to turn a cache _down_ on a constrained host.

| Setting                       | Default | Effect                                                                        |
| ----------------------------- | ------- | ----------------------------------------------------------------------------- |
| `COMPUTE_DEFINITION_CACHE_MB` | `256`   | MB of uploaded `.gh` bytes to keep. `0` disables.                             |
| `COMPUTE_SOLVE_CACHE_MB`      | `256`   | MB of results to keep, **per compute server** (×16 worst case). `0` disables. |
| `COMPUTE_SERVER_CACHESOLVE`   | `true`  | Let Rhino.Compute cache and return solve results.                             |

---

## How to tell a cache is working

**Start at `/admin/compute`.** The Caching panel shows a live hit rate for the solve and definition
caches, with entry and byte counts. A rate that climbs while you scrub a slider is working. A rate
stuck at 0% means every solve reaches Rhino. `—` means nothing has consulted that cache yet.

Counters are per Selva instance and reset on restart.

For one request, read the `Server-Timing` header on the solve response:

| What you see                             | Means                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| No request in the network panel          | The browser had the result and answered itself.                                |
| `selva_cache;dur=1`                      | Solve cache hit; Selva answered without calling Rhino.                         |
| `selva_cache;dur=0`                      | Solve cache miss; the request went to Rhino.                                   |
| `def_bytes;desc=hit`                     | Definition cache hit; no storage read.                                         |
| `def_bytes;desc=miss`                    | Definition cache miss; the `.gh` was read from storage.                        |
| `def_bytes;desc=skipped`                 | A pointer-known re-solve moved no bytes.                                       |
| `def_reupload;dur=1`                     | The server had forgotten the pointer, so the `.gh` went up again.              |
| `rhino_cache;dur=1`                      | `cachesolve` hit on the compute server (reported by the VektorNode fork only). |
| Small outgoing body carrying a `pointer` | Pointer reuse is working.                                                      |

For more detail set `SELVA_FLAG_COMPUTE_DEBUG=on` (`off` | `on` | `verbose`). The server then logs a
per-solve phase breakdown, running definition-cache hit/miss/dropped counts, and each time a solve
joins one already running.
