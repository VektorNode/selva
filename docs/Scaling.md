# Scaling

Selva currently runs fine for a handful of concurrent users. This page maps where
the architecture hits its limits as usage grows, and lays out a staged roadmap:
what to fix now, what to build next, and what to defer until traffic justifies it.

The guiding numbers: solve payloads range from a few KB to **~100 MB+**, results
are **usually unique per solve** (so result caching has a low ceiling), and the
expensive, hard-to-scale resource is the **Rhino.Compute server** (Windows-only,
licensed, minutes to boot).

---

## Where we stand today

One solve request, synchronous end to end:

```
Browser ──HTTP POST /api/v1/compute──► Selva server ──HTTP──► Rhino.Compute
        ◄────── full JSON result ──┘            ◄── JSON ──┘
```

- The client never talks to Rhino.Compute directly. The Selva server proxies
  everything and holds the compute URL + API key
  ([+server.ts](../packages/selva/src/routes/api/v1/compute/+server.ts)).
- The full `.gh`, the full input tree, and the full result are each **buffered
  whole in Node memory**, then `JSON.stringify`-ed once and gzipped with
  `gzipSync`. The size caps in
  [computeLimits.ts](../packages/selva/src/lib/server/computeLimits.ts) exist
  because a single serialized response approaches V8's ~512 MB string ceiling.
- File/geometry **inputs and outputs travel as base64 inside JSON** (~4/3
  inflation). ADR 0003 (below) addresses the output side.
- Multiple compute servers are supported
  ([IComputeServerStore](../packages/platform/src/computeServer/interface.ts)),
  but resolution is **pinning, not load balancing**: each definition resolves to
  exactly one server, with a per-server in-process FIFO queue
  ([clientCache.server.ts](../packages/selva/src/lib/server/compute/clientCache.server.ts)).
  `@selvajs/compute` has a `RetryPolicy`, but Selva never wires it (`attempts: 0`).
- Three cache layers already exist and stack — see [Caching.md](./Caching.md).
  The **definition pointer cache is per compute server**, which constrains how
  load balancing must work (see below).
- Telemetry is good: `Server-Timing` headers on every solve, per-attempt solve
  metrics via the metric sink. Use these numbers to pick the next bottleneck
  before starting each phase.

### What breaks first, in order

| #   | Bottleneck                                                         | Symptom                                                                       |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | `gzipSync` + `JSON.stringify` of ~100 MB bodies on the main thread | One big solve freezes **every** concurrent request on the Node server         |
| 2   | Base64-in-JSON for large file outputs                              | ~1 GB browser-tab memory per solve; server hits the V8 string wall (ADR 0003) |
| 3   | Single compute server per definition, no retries                   | Queue buildup, transient failures surface to users                            |
| 4   | Synchronous request/response with a 100 s ceiling                  | Long solves impossible; connections held open under load                      |
| 5   | In-process queue/caches                                            | Can't run a second Selva instance without losing them                         |

---

## 1. Moving big data

**Principle: pass big data by reference, not by value.** The pieces exist —
`IStorageProvider` with public/presigned URLs (Supabase Storage fronted by CDN).

Near-term, no architecture change:

- **File inputs stop being base64-in-JSON.** Client uploads to storage first (or
  `multipart/form-data`), then references the blob in the solve request. Saves
  33% on the wire and removes a 100 MB string from the JSON body.
- **Streaming compression.** Replace `gzipSync` with a zlib transform stream
  (chunked transfer, drop the explicit `Content-Length`) so a big response never
  blocks the event loop.
- **File outputs go out-of-band** — this is
  [ADR 0003](./adr/0003-large-file-output-streaming.md): large `file` outputs are
  staged to storage and the solve response carries a small `file-ref` descriptor;
  the browser streams the download separately. Eliminates the V8 wall and the
  ~5 concurrent in-memory copies in the tab.
- **Parse off the main thread.** The browser currently does `res.text()` +
  `JSON.parse` on the whole body; move parsing and mesh decoding into a Web
  Worker.

Structural (the keystone for everything in §2):

- **Async job model with results in object storage.** `POST /api/v1/compute`
  enqueues and returns a job ID; a worker solves and writes results to storage
  (small JSON manifest + **binary blobs** for meshes/geometry); the client is
  notified (polling or SSE) and downloads **directly from storage via presigned
  URL** — the heavy bytes never transit the Node heap. This removes the memory
  wall, the 100 s ceiling, and the blocked event loop in one move, and provides
  the queue that compute load balancing needs anyway.
- **Binary mesh encoding.** The plugin WebSocket path already streams trailing
  binary mesh frames; the cloud path should converge on the same encoding
  instead of JSON-with-base64. Draco (or plain quantized buffers) typically cuts
  mesh size 5–10× before compression even starts.

## 2. Compute load balancing and autoscaling

The critical constraint: **the definition pointer cache and `cachesolve` are per
compute server** ([Caching.md](./Caching.md)). Naive round-robin destroys both —
every solve would re-upload a multi-MB `.gh`.

- **Definition-sticky routing.** Consistent-hash on definition ID across the
  server pool, spilling to the least-loaded server when the home server is
  saturated (accepting one re-upload). Keeps the pointer cache hot while
  spreading distinct definitions.
- **A real queue in the middle.** The job model above provides it. At current
  scale a Postgres-backed queue (e.g. `pg-boss` on the existing Supabase
  Postgres) is the low-ops choice; Redis/BullMQ if a Redis appears for other
  reasons. Queue depth per definition/server becomes the load signal, replacing
  the in-process FIFO (which dies with the Node process and can't span
  instances).
- **Wire the retry policy** that `@selvajs/compute` already ships — transient
  failures are routine when compute instances recycle.
- **Health-based eviction.** The status probe exists
  ([useServerHealth.svelte.ts](../packages/selva/src/lib/composables/useServerHealth.svelte.ts));
  extend it so unhealthy servers are pulled from routing automatically, not just
  shown in the admin UI.
- **Autoscaling Rhino.Compute** — no official solution exists (McNeel
  deliberately ships the backend, not a scaling system). The design below is
  DIY, built on these confirmed facts:

### How one server scales (do this first)

`rhino.compute` is a thin frontend that **round-robins** across
`compute.geometry` children (each a full headless Rhino). CLI args:
`--childcount` (default 4, cap 64), `--idlespan` (default 3600 s — children
self-terminate when idle and **billing stops**), `--spawn-on-startup`
(pre-warm). Max out cores + children on one VM before adding VMs. Note
`RHINO_COMPUTE_MAX_REQUEST_SIZE` defaults to ~50 MB — must be raised for large
payloads (see `computeLimits.ts`).

### Licensing / cost model

[Core-Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/):
**$0.10 per core per hour, billed on Rhino uptime, not usage** (idle 8-core VM
≈ $576/mo). Per **core**, not per instance — 64 children on one box cost the
same as 1. **One `RHINO_TOKEN` licenses the whole fleet** (treat it as a
secret — it bills your card). Scaling out is licensing-trivial; the cost lever
is scaling back down (idlespan + stopping VMs).

### Pool design: pin definitions to a group, not a server

- `ComputeServerGroup` in `IComputeServerStore`: shared config + member
  instances with health state. Existing single servers become groups of one.
- **Definition-sticky routing** (rendezvous hash on definition ID) inside the
  group — the pointer cache is **in-memory per instance** and McNeel does not
  support cross-instance pointer reuse. Spill to least-loaded on saturation;
  the client's transparent re-upload (`definition_not_cached`, VektorNode fork)
  makes a spill cost one re-upload, not an error.
- **Health eviction**: N failed probes → out of the routing set; retries
  (RetryPolicy) cover in-flight failures.
- **Autoscaler = control loop** over `IComputeInstanceController
{ start, stop, status }` with cloud backends (start/stop **pre-provisioned**
  VMs — never create at scale-time) and a no-op for static setups. Scale out on
  _sustained_ queue depth (a Windows VM needs ~2–5 min to be useful); scale in
  by draining (unroute → finish in-flight → stop). Configurable warm floor
  (1 instance, or 0 for cold-start-tolerant orgs). The scale signal is queue
  depth — this hard-depends on the Phase 2 job queue.

### Rhino 9 Linux (BETA, announced 2026-03-18)

[Rhino.Compute on Linux](https://developer.rhino3d.com/en/guides/compute/compute-linux-getting-started/)
is an official **BETA**: apt package on Ubuntu 24.04 / AmazonLinux 2023,
systemd, .NET 9, Docker works, core-hour-billing-only licensing. It would make
autoscaling cheap and fast (container boot in seconds, spot instances viable
under a queue + retries). **Not production-ready yet**, and two Selva-specific
blockers: (1) the **VektorNode fork must be ported** to the 9.x/Linux branch
for block-instance support; (2) only yak packages marked `-any` install —
Selva's yak packaging must be verified. Also: RhinoCode script components
unsupported, file I/O 3dm-only. Action: run a prototype spike now; build the
pool/controller design provider-agnostically so the backend swap (Windows VMs
→ Linux containers) is contained.

### Near-term stance: no image autoscaling yet — queue, fixed pool, routing

The deliberate decision for now is to **not** automate spinning up compute
instances, and instead spend the effort in this order:

1. **Vertical first — it's free.** More cores + `--childcount` on the existing
   VM costs the same per core-hour as scaling out and needs zero routing work.
   Tune `--idlespan` so idle Rhino isn't billing.
2. **The queue is the real investment, more than caches.** The async job model
   (§1) does double duty: it fixes the big-data path _and_ it is the
   prerequisite for any scaling automation — queue depth is the only meaningful
   scale signal. Anything built before the queue, an autoscaler can't use.
3. **Load balancing, the cheap kind.** A _fixed_ pool of 2–3 instances with
   definition-sticky routing and health eviction: static config + routing logic
   in Selva, no cloud APIs, no image management — and it removes today's
   single-server point of failure.
4. **Caches: protect more than build.** Results are mostly unique, so the
   caching work is (a) not losing what exists — sticky routing keeps the
   pointer cache hot — and (b) the opt-in per-definition result cache (§3).
   Nothing fancier until `selva_cache` hit-rate telemetry justifies it.

Deferring image autoscaling isn't because it's wrong — it's the
highest-complexity item, it can't be built well yet (no queue metrics to drive
it), and the Rhino 9 Linux BETA means the infrastructure target will likely
look completely different within ~6–12 months (containers + spot instances
instead of Windows VM power-toggling). A Windows VM autoscaler built today
risks being throwaway work. The one thing to do _now_ on that track is the
**Linux prototype spike**, because the VektorNode fork port is the long-lead
item either way.

**2–3 fixed compute servers + sticky routing + a queue carries 5–50 users
comfortably.**

## 3. Caching when results are almost always unique

When outputs are unique per input, result caching has near-zero hit rate no
matter how clever the cache. The strategy shifts:

- **Cache the stable upstream artifacts aggressively** — definition bytes,
  pointer reuse, warm clients. Already done ([Caching.md](./Caching.md));
  protect it (that's what sticky routing is for).
- **Keep input-hash result caching only for the cheap cases.** The in-process
  cache + `cachesolve` already catch "same user re-solves identical inputs"
  (slider bounce-back, reload). Before investing in a _distributed_ result cache,
  **measure the hit rate** via the existing `selva_cache` / `fromCache`
  telemetry. If it's low (likely), spend elsewhere.
- **Durable result caching is per-definition opt-in, default off.** Only the
  definition author knows whether their definition is deterministic and has an
  enumerable input space (dropdowns, value lists, stepped sliders) — the profile
  where hit rates are high. Design sketch: a `cachePolicy` field flat on
  `DefinitionRecord` (same precedent as the `computeServerId` pin); cache key =
  `SHA-256(version.id + canonicalized input tree)` — versions are immutable, so
  a re-upload mints a new version id and **invalidation is automatic**; entries
  stored via `IStorageProvider` under `solve-cache/{versionId}/{inputHash}`
  (durable, cross-instance, provider-agnostic); checked in the route between
  input-tree build and `scheduler.solve`, written back asynchronously on miss.
  Guardrails: per-definition entry/byte budget with LRU sweep, slider values
  rounded to their step before hashing, prefix GC when live/draft re-points, and
  cache the result _before_ ADR 0003 file-output partitioning so entries never
  reference expired staged files.
- **For unique 100 MB payloads the lever is transfer efficiency, not caching**:
  binary encoding, Draco meshes, streaming, direct-from-storage downloads. CDN
  helps only for _re-downloads_ of the same stored result (reopening a project,
  a shared link) — worth having via storage-backed blobs, not worth engineering
  beyond that.
- **Later refinement: content-address output blobs** (key = hash of bytes). Even
  when a solve is "different", often only some outputs changed — unchanged
  meshes dedupe in storage for free, and a client that already holds a blob hash
  skips the download. Partial caching without predicting what changes.

## 4. Networking and Selva server scaling

- Client ↔ Selva stays HTTPS. The WebSocket stays plugin-local, bound to loopback;
  for job-status pushes in the cloud path, **SSE** is sufficient and far easier
  behind load balancers.
- Put compute servers, the Selva server, and storage **in the same VPC/region**
  — the server ↔ compute hop carries the fattest payloads; internal traffic can
  skip compression entirely.
- The Selva server is nearly stateless already (Supabase mode; the local
  provider is single-instance by design). What blocks horizontal scaling is
  exactly the in-process state: the FIFO queue, the warm-client LRU, the remote
  definition byte cache, and the fixed-window rate limiter. The job queue
  externalizes the first; the caches are acceptable per-instance, where a split
  costs only hit rate.
- **The rate limiter is the exception, and needs a decision before instance two.**
  Splitting its buckets across N instances doesn't degrade a cache — it multiplies
  the enforced rate by N, since each instance independently admits a full window
  per key. Either accept N× and size the configured limit for it, or move the
  limiter to a shared store; the state sits behind `createComputeRateLimiter` so
  a Redis implementation slots in without touching call sites. (Memory growth is
  already handled — buckets self-evict.)

---

## Roadmap

| Phase | When            | Work                                                                                                                                                                                                                                                                    |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Now (cheap)     | Wire retries; streaming gzip; file inputs via storage/multipart; revert the TEMP 300 MB limits; browser parsing in a Web Worker; ship [ADR 0003](./adr/0003-large-file-output-streaming.md); Rhino 9 Linux prototype spike (VektorNode fork port is the long-lead item) |
| 2     | Next (keystone) | Async job model: queue + worker + results-to-storage + presigned downloads + binary mesh encoding (needs its own ADR)                                                                                                                                                   |
| 3     | Then            | Multiple compute servers behind definition-sticky routing with health-based eviction; collect queue-depth metrics                                                                                                                                                       |
| 4     | When justified  | Warm-pool compute autoscaling (Core-Hour Billing); horizontal Selva instances; content-addressed output blobs                                                                                                                                                           |

Each phase ends with a measurement checkpoint: `Server-Timing` breakdowns and
the solve-metric sink already record where time and bytes go — let them pick the
next bottleneck rather than this document.
