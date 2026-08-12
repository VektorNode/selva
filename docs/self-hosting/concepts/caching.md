---
title: Caching
order: 5
published: false
description: 'Where Selva caches (browser, server, and Rhino.Compute), what invalidates each cache, and how to tell one is working.'
---

# Caching

Solving a Grasshopper definition is the expensive part of Selva. Caching avoids repeating work, and
also avoids re-uploading definitions, re-decoding meshes, and re-uploading geometry to the GPU.

There are **only two names you ever have to know**, each named for what it holds:

| Name                 | Holds                                       | You configure it with         |
| -------------------- | ------------------------------------------- | ----------------------------- |
| **Definition cache** | `.gh` file bytes                            | `COMPUTE_DEFINITION_CACHE_MB` |
| **Solve cache**      | solve results, keyed on definition + inputs | `COMPUTE_SOLVE_CACHE_MB`      |

Both settings are **sizes in MB**, both are **on by default**, and `0` turns one off. There is no
provider to pick, no quota that is secretly an on/off switch, and no combination to get right.

**The browser caches nothing across solves except the last few solve results.** The viewer rebuilds
its scene every solve and owns every geometry and texture it builds, so there is no viewer cache to
reason about, configure, or clear.

---

## The 60-second summary

```
Browser ─────────────► Selva server ─────────────► Rhino.Compute
 recent results         solve cache,                definition cache,
                        definition cache            cachesolve
```

**Result caches. These decide whether you see fresh output:**

| Cache            | Runs in         | Skips                              | Default | Configurable |
| ---------------- | --------------- | ---------------------------------- | ------- | ------------ |
| Recent results   | Browser         | the whole round-trip               | on      | no           |
| Solve cache      | Selva server    | the network call **and** the solve | on      | yes          |
| Definition cache | Selva server    | reading the `.gh` from storage     | on      | yes          |
| Pointer reuse    | Selva ↔ Compute | re-uploading the `.gh`             | on      | yes          |
| `cachesolve`     | Rhino.Compute   | the solve                          | on      | yes          |

**Everything else needs no configuration:** the warm-client cache, and the mechanism that makes
identical solves arriving at once share a single run. Both are described in
[Caches you don't configure](#caches-you-dont-configure).

---

## The rule that explains most of it: keys that can never go stale

Almost nothing here ever has to be actively thrown away. Instead, most caches key on something whose
meaning can never change:

> **Publishing a definition gives it a new version id. Entries for the new version land under keys
> nothing has used before, so there is nothing to clear; old entries simply age out.**

The definition cache keys on the **version id**, which never changes once assigned. Editing a
definition creates a new version, so its cache entries are new too. Rolling back re-hits the old
entries, correctly. This is why it has no "clear" button, and why it needs none.

Only two caches ever discard an entry deliberately:

- **Recent browser results** clear when you switch to a different definition.
- **The warm-client cache** drops a server when its URL or API key changes.

### Where this leaves you

Two situations produce entries that linger. Neither causes wrong output:

1. **You delete a definition.** Its definition-cache entries stay in memory until they age out under
   the byte budget. Harmless; nothing can reach them.
2. **You upgrade Rhino on an existing compute server, keeping the same server entry.** The solve cache
   lives per warm compute client and is dropped when that client is evicted or the process restarts, so
   a Rhino upgrade in place is worth a Selva restart to be certain nothing solved by the old version
   survives.

---

## The result caches, one at a time

### Recent results, in the visitor's browser

The first thing checked. Holds the last **16** solve results, looked up by the input values that
produced them. Dragging a slider back to a value you already solved this session returns instantly,
and no request leaves the browser.

- ✅ Instant, and the request never happens at all: zero load on the server.
- ❌ Per browser tab; gone on reload. Misses whenever an input is genuinely new.
- **Cleared** when the active definition changes. Not configurable.

### Solve cache, in the Selva server

If the same definition with the same inputs has been solved on **this** Selva process, the stored
result is returned without calling Rhino.Compute at all.

- ✅ Skips both the network round-trip and the solve.
- ❌ One process's memory. Lost on restart, not shared across instances.
- **Limit:** `COMPUTE_SOLVE_CACHE_MB`, default 256 MB. `0` disables.
- **Nothing expires on a timer.** Memory is the only pressure: when the budget is exceeded the
  entries unused longest are dropped first, and there is no cap on how many are held. The same
  definition with the same inputs always produces the same result, and neither can change under a
  stored entry, so a kept result cannot go stale, and expiring one could only force a paid re-solve of
  the identical answer.
- ⚠️ **The one exception is a definition that reaches outside its inputs:** a component reading a
  live URL, a database, or the clock. Its output isn't a function of its inputs, so a cached result
  can be genuinely wrong rather than merely old. Nothing detects this; a restart is the blunt fix.
- ⚠️ **The budget is per compute server**, and Selva keeps up to 16 warm. A deployment spread across
  many compute servers can hold `256 MB × 16` in the worst case. Lower `COMPUTE_SOLVE_CACHE_MB`
  if you run more than a couple of servers on a memory-constrained host.

### Definition cache, in the Selva server

Holds `.gh` file bytes so a re-solve doesn't re-read a multi-MB definition from disk or S3. Combined
with pointer reuse, a warm re-solve moves **zero** definition bytes.

- **Limit:** `COMPUTE_DEFINITION_CACHE_MB`, default 256 MB. `0` disables.

**It has two sources, and only one can go stale.** A definition reaches a solve one of two ways, and
they expire differently because their sources differ in mutability:

| Source                           | Keyed on                  | Re-read after | Why                                              |
| -------------------------------- | ------------------------- | ------------- | ------------------------------------------------ |
| **Uploaded** to Selva            | version id (never reused) | **never**     | a published version's bytes can never change     |
| **Remote URL** (`definitionUrl`) | the URL                   | **5 min**     | whoever owns the URL can swap the file under you |

That five minutes is `REMOTE_DEFINITION_CACHE_TTL_MS`, and its name is worth reading literally: it
applies **only** to remote-URL fetches. Expiring the uploaded path would be a bug, not a safety
measure: a version id always points at the same bytes, so re-reading them could only throw away
valid work.

### Pointer reuse, how the definition is sent

Not a result cache. Normally Selva uploads the whole `.gh` on every solve; with pointer reuse it
uploads once, gets a key back, and afterwards sends just the key.

- ✅ **The only cache that helps while inputs keep changing,** such as slider scrubbing on a large definition.
- ❌ Doesn't skip the solve; it only shrinks the upload.
- If the server forgot the key, Selva re-uploads automatically. No error.
- ⚠️ **Safety:** auto-recovery needs a server that reports a forgotten key correctly (the VektorNode
  fork does). On a Rhino.Compute server you don't control, a forgotten key could return empty
  geometry. Set `COMPUTE_REUSE_DEFINITION_CACHE=false`.

### `cachesolve`, Rhino.Compute's own result cache

Asks the compute server to remember results, keyed on definition + inputs.

- ✅ Lives on the compute box (memory + disk), so it **survives Selva restarts** and is **shared by
  every Selva instance** hitting that server.
- ❌ Still costs a network round-trip. Heaviest memory/disk cost of any cache here.
- Errored solves are never cached unless explicitly opted in.
- **Purge:** `POST cache/purge` on the compute server. A compute server runs several Rhino processes
  side by side and the purge only reaches one of them, so clearing it fully means calling it
  repeatedly.

---

## Caches you don't configure

Listed so you know they exist; none has settings and none can serve stale content.

| Cache                  | Runs in      | Keyed on                     | Bound                   |
| ---------------------- | ------------ | ---------------------------- | ----------------------- |
| Warm-client cache      | Selva server | compute server id            | 16 servers              |
| Shared runs            | Selva server | definition + server + inputs | only while a solve runs |
| Shared edge extraction | Browser      | mesh content hash            | only while it runs      |

**Warm-client cache** keeps a live, connected client per compute server rather than reconnecting each
solve. It drops a server automatically when you change its URL or key.

**Shared runs.** Identical solves that arrive at the same moment run once and share the result, so a
popular public definition doesn't hit compute with a hundred copies of the same work right after a
deploy. It is not a cache: nothing is stored, and the entry disappears the moment the solve finishes.
It runs for **every** solve, which matters most when the solve cache is off. That is exactly when
N identical requests would each pay a full Rhino round trip.

**Shared edge extraction** is not a cache either: when several meshes in one solve are identical, the
edges are worked out once and shared instead of once per copy. The entry is released as soon as that
finishes.

> **The browser used to keep geometry, textures and mesh edges between solves. It no longer does.**
> Those caches were removed in August 2026 because nobody had reported the problem they were meant
> to solve, and carrying them made the viewer harder to reason about. The viewer now rebuilds each
> solve's geometry from scratch and owns everything it builds. Nothing to configure, and no setting
> disappeared with them.

---

## Where to change settings

Server-side, in [`packages/selva/.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example) (copy to `.env`).
Defaults and parsing live in [`packages/server/src/compute/limits.ts`](https://github.com/VektorNode/selva/blob/main/packages/server/src/compute/limits.ts).

**Selva's own caches. Two settings, both sizes:**

| Setting                       | Cache            | Default | What it does                                                                          |
| ----------------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------- |
| `COMPUTE_DEFINITION_CACHE_MB` | Definition cache | `256`   | How much `.gh` data to keep warm. `0` disables.                                       |
| `COMPUTE_SOLVE_CACHE_MB`      | Solve cache      | `256`   | How many results to keep warm, **per compute server** (×16 worst case). `0` disables. |

**Rhino.Compute server flags.** These configure the remote compute server's own features, not Selva's
caches:

| Setting                          | Default  | What it does                                                       |
| -------------------------------- | -------- | ------------------------------------------------------------------ |
| `COMPUTE_REUSE_DEFINITION_CACHE` | `true`   | Send a pointer instead of re-uploading the `.gh`.                  |
| `COMPUTE_SERVER_CACHESOLVE`      | `true`   | Let Rhino.Compute cache and return solve results.                  |
| `COMPUTE_CACHE_ERRORED_SOLVES`   | `false`  | Also cache solves that reported Grasshopper errors.                |
| `REMOTE_DEFINITION_CACHE_TTL_MS` | `300000` | Freshness bound on `.gh` bytes fetched from a **remote URL** only. |

Restart the Selva server after editing `.env`.

> **Renamed in 2026-07.** `COMPUTE_DEFINITION_BYTE_CACHE_MB` → `COMPUTE_DEFINITION_CACHE_MB`,
> `COMPUTE_RESPONSE_CACHE_MB` → `COMPUTE_SOLVE_CACHE_MB`, `DEFINITION_CACHE_TTL_MS` →
> `REMOTE_DEFINITION_CACHE_TTL_MS`. The old names still work for one minor version and log a warning
> at boot naming their replacement. `SOLVE_CACHE_PROVIDER`, `SOLVE_CACHE_DEFAULT_MAX_ENTRIES` and
> `SOLVE_CACHE_MAX_TOTAL_MB` are **gone**. They configured a durable cache tier that duplicated the
> solve cache in the same process, and were removed along with it.

---

## Which should I turn on?

**Defaults are right for most deployments.** Everything is on; the two settings exist to turn a cache
_down_ on a memory-constrained host, not to switch features on.

| Situation                                                      | Do this                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Large `.gh` files, lots of slider scrubbing                    | Defaults. Pointer reuse is the one that helps; result caches can't.                                            |
| Public configurator, few fixed presets, **multiple instances** | Rely on `cachesolve`. It lives on the compute box, so it is the one tier that survives an instance going cold. |
| Single internal instance, redeployed often                     | Defaults. The solve cache does the work; it refills after a deploy.                                            |
| Compute server memory-constrained, large outputs               | `COMPUTE_SERVER_CACHESOLVE=false`; its stored results are the heaviest cost.                                   |
| Many compute servers on a small Selva host                     | Lower `COMPUTE_SOLVE_CACHE_MB` (it's per server, ×16 worst case).                                              |
| Pointed at a Rhino.Compute server you don't control            | `COMPUTE_REUSE_DEFINITION_CACHE=false` (see pointer-reuse safety note).                                        |

---

## How to tell a cache is working

**Start at `/admin/compute`.** The Caching panel shows a live hit rate for the solve cache and the
definition cache, with the entry/byte counts behind it and the env var that sizes each. A hit rate
that climbs while you scrub a slider is the system working; one that stays at 0% means every solve is
reaching Rhino.

Counters are per Selva instance and reset when it restarts, so behind a load balancer each instance
reports only its own. A rate of `—` means nothing has consulted that cache yet, which is different
from 0%.

For a single request, every solve response carries a `Server-Timing` header:

| What you see                                      | Means                                                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| No request in the network panel at all            | The browser had this result already and answered itself.   |
| `selva_cache;dur=1`                               | Solve cache hit; Selva answered without calling Rhino.     |
| `def_bytes;desc=hit`                              | Definition cache hit; bytes served without a storage read. |
| `def_bytes;desc=skipped`                          | Best case: a pointer-known re-solve moved no bytes at all. |
| `solve` time near zero, but a round-trip happened | `cachesolve` hit on the compute server.                    |
| Small outgoing body carrying a `pointer`          | Pointer reuse is working; the `.gh` is not in the request. |

For deeper detail, set `SELVA_FLAG_COMPUTE_DEBUG=on`. The server then logs a per-solve phase
breakdown plus running hit/miss/dropped counts for the definition cache, and a line each time a solve
joins one already running instead of starting its own.

> **Merged in 4.8.** `SELVA_FLAG_COMPUTE_DEBUG` is now three-way (`off` | `on` | `verbose`) instead of
> a separate `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE` boolean. `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE=true` still
> works for one minor version, treated as `SELVA_FLAG_COMPUTE_DEBUG=verbose` with a boot warning,
> after which it stops being read at all.
