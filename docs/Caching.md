---
title: Caching
group: Concepts
order: 5
published: true
description: 'Where Selva caches — browser, server, and Rhino.Compute — what invalidates each cache, and how to tell one is working.'
---

# Caching

Solving a Grasshopper definition is the expensive part of Selva. Caching avoids repeating work — and
also avoids re-uploading definitions, re-decoding meshes, and re-uploading geometry to the GPU.

There are a lot of individual caches, but **only three names you ever have to know**, each named for
what it holds:

| Name                 | Holds                                       | You configure it with         |
| -------------------- | ------------------------------------------- | ----------------------------- |
| **Definition cache** | `.gh` file bytes                            | `COMPUTE_DEFINITION_CACHE_MB` |
| **Solve cache**      | solve results, keyed on definition + inputs | `COMPUTE_SOLVE_CACHE_MB`      |
| **Viewer cache**     | geometry and textures with live GPU buffers | nothing — see below           |

Both settings are **sizes in MB**, both are **on by default**, and `0` turns one off. There is no
provider to pick, no quota that is secretly an on/off switch, and no combination to get right.

---

## First: "cache" means two different things

Almost every confusion about caching in Selva comes from mixing these up.

| Kind                    | Holds                                    | Why it exists                                      | Can it go stale?                                |
| ----------------------- | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| **Result caches**       | finished solve results, definition bytes | skip work                                          | **Yes** — this is where freshness lives         |
| **GPU-resource caches** | live Three.js geometries and textures    | the viewer rebuilds the whole scene on every solve | **No** — keyed on content, disposed on eviction |

If you're debugging "why am I seeing an old result?", you only care about **result caches**. The
GPU-resource caches are an ownership concern (who disposes what), not a freshness one.

---

## The 60-second summary

```
Browser ─────────────► Selva server ─────────────► Rhino.Compute
 memo, viewer caches    solve cache,                definition cache,
                        definition cache            cachesolve
```

**Result caches — these decide whether you see fresh output:**

| Cache             | Tier            | Skips                              | Default | Configurable |
| ----------------- | --------------- | ---------------------------------- | ------- | ------------ |
| Client solve memo | Browser         | the whole round-trip               | on      | no           |
| Solve cache       | Selva server    | the network call **and** the solve | on      | yes          |
| Definition cache  | Selva server    | reading the `.gh` from storage     | on      | yes          |
| Pointer reuse     | Selva ↔ Compute | re-uploading the `.gh`             | on      | yes          |
| `cachesolve`      | Rhino.Compute   | the solve                          | on      | yes          |

**Everything else needs no configuration** — the warm-client cache, the browser's viewer caches, and
the single-flight coalescer. They're described in
[Caches you don't configure](#caches-you-dont-configure).

---

## The rule that explains most of it: immutable keys, not invalidation

Selva deliberately has **almost no cache invalidation**. Instead, most caches key on something that
can never change meaning:

> **Publishing a definition mints a new version id, which is a fresh keyspace. There is nothing to
> invalidate — old entries simply age out.**

The definition cache keys on the **version id**, an immutable UUID. Editing a definition creates a new
version, so its cache entries are new too. Rolling back re-hits the old entries, correctly. This is why
it has no "clear" button, and why it needs none.

The browser's geometry and texture caches use the same trick from the other direction: they key on the
**content** of what they hold (a hash of the mesh bytes, a content-addressed texture URL), so a key can
never refer to different content than it did before.

Only two caches have real invalidation:

- **The client solve memo** clears when you switch to a different definition.
- **The warm-client cache** evicts when a compute server's URL or API key changes.

### Where this leaves you

Two situations produce entries that linger. Neither causes wrong output:

1. **You delete a definition** — its definition-cache entries stay in memory until they age out under
   the byte budget. Harmless; nothing can reach them.
2. **You upgrade Rhino on an existing compute server, keeping the same server entry.** The solve cache
   lives per warm compute client and is dropped when that client is evicted or the process restarts, so
   a Rhino upgrade in place is worth a Selva restart to be certain nothing solved by the old version
   survives.

---

## The result caches, one at a time

### Client solve memo — in the visitor's browser

The first thing checked. Holds the last **16** solve results, keyed on a stable hash of the input
values. Dragging a slider back to a value you already solved this session returns instantly — no
request leaves the browser.

- ✅ Instant, and the request never happens at all — zero load on the server.
- ❌ Per browser tab; gone on reload. Misses whenever an input is genuinely new.
- **Invalidation:** cleared when the active definition changes. Not configurable.

### Solve cache — in the Selva server

If the same definition with the same inputs was solved recently on **this** Selva process, the stored
result is returned without calling Rhino.Compute at all.

- ✅ Skips both the network round-trip and the solve.
- ❌ One process's memory — lost on restart, not shared across instances.
- **Limit:** `COMPUTE_SOLVE_CACHE_MB`, default 256 MB. `0` disables.
- ⚠️ **The budget is per compute server**, and Selva keeps up to 16 warm. A deployment fanned out
  across many compute servers can hold `256 MB × 16` in the worst case. Lower `COMPUTE_SOLVE_CACHE_MB`
  if you run more than a couple of servers on a memory-constrained host.

### Definition cache — in the Selva server

Holds `.gh` file bytes so a re-solve doesn't re-read a multi-MB definition from disk or S3. Combined
with pointer reuse, a warm re-solve moves **zero** definition bytes.

- **Limit:** `COMPUTE_DEFINITION_CACHE_MB`, default 256 MB. `0` disables.

**It has two sources, and only one can go stale.** A definition reaches a solve one of two ways, and
they expire differently because their sources differ in mutability:

| Source                           | Keyed on                    | TTL       | Why                                              |
| -------------------------------- | --------------------------- | --------- | ------------------------------------------------ |
| **Uploaded** to Selva            | version id (immutable UUID) | **none**  | a published version's bytes can never change     |
| **Remote URL** (`definitionUrl`) | the URL                     | **5 min** | whoever owns the URL can swap the file under you |

That TTL is `REMOTE_DEFINITION_CACHE_TTL_MS`, and its name is worth reading literally: it bounds
**only** remote-URL fetches. Putting a TTL on the uploaded path would be a bug, not a safety measure —
version ids are immutable, so expiring those entries could only ever throw away valid work.

### Pointer reuse — how the definition is sent

Not a result cache. Normally Selva uploads the whole `.gh` on every solve; with pointer reuse it
uploads once, gets a key back, and afterwards sends just the key.

- ✅ **The only cache that helps while inputs keep changing** — slider scrubbing on a large definition.
- ❌ Doesn't skip the solve; it only shrinks the upload.
- If the server forgot the key, Selva re-uploads automatically. No error.
- ⚠️ **Safety:** auto-recovery needs a server that reports a forgotten key correctly (the VektorNode
  fork does). On a Rhino.Compute server you don't control, a forgotten key could return empty
  geometry — set `COMPUTE_REUSE_DEFINITION_CACHE=false`.

### `cachesolve` — Rhino.Compute's own result cache

Asks the compute server to remember results, keyed on definition + inputs.

- ✅ Lives on the compute box (memory + disk), so it **survives Selva restarts** and is **shared by
  every Selva instance** hitting that server.
- ❌ Still costs a network round-trip. Heaviest memory/disk cost of any cache here.
- Errored solves are never cached unless explicitly opted in.
- **Purge:** `POST cache/purge` on the compute server — per child process, so a multi-child fleet needs
  repeated purges.

---

## Caches you don't configure

Listed so you know they exist; none has settings and none can serve stale content.

| Cache                   | Tier         | Keyed on                     | Bound           |
| ----------------------- | ------------ | ---------------------------- | --------------- |
| Warm-client cache       | Selva server | compute server id            | 16 servers, LRU |
| Single-flight coalescer | Selva server | definition + server + inputs | in-flight only  |
| Geometry cache          | Browser      | mesh **content** hash        | 256 MiB         |
| Texture cache           | Browser      | content-addressed URL        | 64 textures     |
| Edge segment cache      | Browser      | mesh content hash            | 128 MiB         |

**Warm-client cache** keeps a live, connected client per compute server rather than reconnecting each
solve. It evicts automatically when you change a server's URL or key.

**Single-flight coalescer** collapses simultaneous identical solves into one execution, so a hot public
definition doesn't stampede compute after a deploy. It is not a cache — nothing is stored, and the key
is released the moment the solve settles. It runs for **every** solve, which matters most when the
solve cache is off: that is exactly when N identical requests would each pay a full Rhino round trip.

**The browser's GPU caches** exist because the viewer discards and rebuilds the entire scene on every
solve. Without them, an unchanged mesh would be re-decoded and re-uploaded to the GPU on every slider
move. They dispose their contents on eviction, and every one of them is keyed so that a hit is always
the right content — so none can serve the wrong geometry.

> **Removed 2026-07-30 — the edge line-geometry cache leaked, and is gone rather than fixed.** It used
> to be the one browser cache keyed on object _identity_ rather than content, written when identity
> could not survive a solve ("the viewer rebuilds every `BufferGeometry` each solve, so identity caches
> never hit across solves"). That stopped being true once the geometry cache began returning the _same_
> instance across solves: measured, 8 meshes over 50 solves left **400** live line geometries — with
> resident GPU buffers — instead of 8, because whole-scene clears detached overlays without ever
> decrementing a refcount. Rather than patch the refcounting, the cache was deleted outright
> (`render/edges/line-geometry.ts`): it also turned out to barely help (0/80 hits in a real scrubbing
> loop), since the content-keyed edge segment cache above already covers the common case. Every overlay
> now builds and owns its own line geometry directly, and `clearScene`'s generic dispose walker
> (`shared/gpu-dispose.ts`) frees it like any other scene object — nothing left to bound or release.
> Memory only; it never could serve wrong geometry. Full measurement in
> [caching-audit-2026-07 §F1](./plans/archive/caching-audit-2026-07.md#f1-the-edge-cache-and-geometry-cache-now-contradict-each-other).

---

## Where to change settings

Server-side, in [`packages/selva/.env.example`](../packages/selva/.env.example) (copy to `.env`).
Defaults and parsing live in [`packages/server/src/compute/limits.ts`](../packages/server/src/compute/limits.ts).

**Selva's own caches — two settings, both sizes:**

| Setting                       | Cache            | Default | What it does                                                                          |
| ----------------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------- |
| `COMPUTE_DEFINITION_CACHE_MB` | Definition cache | `256`   | How much `.gh` data to keep warm. `0` disables.                                       |
| `COMPUTE_SOLVE_CACHE_MB`      | Solve cache      | `256`   | How many results to keep warm, **per compute server** (×16 worst case). `0` disables. |

**Rhino.Compute server flags** — these configure the remote compute server's own features, not Selva's
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
> `SOLVE_CACHE_MAX_TOTAL_MB` are **gone** — they configured a durable cache tier that duplicated the
> solve cache in the same process, and were removed along with it.

---

## Which should I turn on?

**Defaults are right for most deployments.** Everything is on; the two settings exist to turn a cache
_down_ on a memory-constrained host, not to switch features on.

| Situation                                                      | Do this                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Large `.gh` files, lots of slider scrubbing                    | Defaults. Pointer reuse is the one that helps; result caches can't.                                             |
| Public configurator, few fixed presets, **multiple instances** | Rely on `cachesolve` — it lives on the compute box, so it is the one tier that survives an instance going cold. |
| Single internal instance, redeployed often                     | Defaults. The solve cache does the work; it refills after a deploy.                                             |
| Compute server memory-constrained, large outputs               | `COMPUTE_SERVER_CACHESOLVE=false` — its stored results are the heaviest cost.                                   |
| Many compute servers on a small Selva host                     | Lower `COMPUTE_SOLVE_CACHE_MB` (it's per server, ×16 worst case).                                               |
| Pointed at a Rhino.Compute server you don't control            | `COMPUTE_REUSE_DEFINITION_CACHE=false` (see pointer-reuse safety note).                                         |

---

## How to tell a cache is working

**Start at `/admin/compute`.** The Caching panel shows a live hit rate for the solve cache and the
definition cache, with the entry/byte counts behind it and the env var that sizes each. A hit rate
that climbs while you scrub a slider is the system working; one that stays at 0% means every solve is
reaching Rhino.

Counters are per Selva instance and reset when it restarts — behind a load balancer, each instance
reports only its own. A rate of `—` means nothing has consulted that cache yet, which is different
from 0%.

For a single request, every solve response carries a `Server-Timing` header:

| What you see                                      | Means                                                       |
| ------------------------------------------------- | ----------------------------------------------------------- |
| No request in the network panel at all            | Client memo hit — the browser answered.                     |
| `selva_cache;dur=1`                               | Solve cache hit — Selva answered without calling Rhino.     |
| `def_bytes;desc=hit`                              | Definition cache hit — bytes served without a storage read. |
| `def_bytes;desc=skipped`                          | Best case — a pointer-known re-solve moved no bytes at all. |
| `solve` time near zero, but a round-trip happened | `cachesolve` hit on the compute server.                     |
| Small outgoing body carrying a `pointer`          | Pointer reuse is working (no base64 `.gh` in the request).  |

For deeper detail, set `SELVA_FLAG_COMPUTE_DEBUG=true` — the server then logs a per-solve phase
breakdown plus cumulative hit/miss/eviction counters for the definition cache, and a line each time a
solve coalesces onto one already in flight.
