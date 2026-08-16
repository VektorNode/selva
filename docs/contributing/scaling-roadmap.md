# Scaling roadmap

The staged plan for lifting the limits described in
[docs/self-hosting/concepts/scaling.md](../self-hosting/concepts/scaling.md).
Everything here is unbuilt design. It is repo-internal on purpose — it is not a
commitment, and it links into source paths a deployment operator has no reason to
open.

Read the operator page first for where the architecture actually stands.

## 1. Moving big data

**Pass big data by reference, not by value.** The pieces exist — `IStorageProvider`
with public/presigned URLs.

Near-term, no architecture change:

- **File inputs stop being base64-in-JSON.** Client uploads to storage first (or
  `multipart/form-data`), then references the blob in the solve request. Saves 33%
  on the wire and removes a 100 MB string from the JSON body.
- **File outputs go out-of-band** ([ADR 0003](../adr/0003-large-file-output-streaming.md)):
  large `file` outputs stage to storage, the solve response carries a small
  `file-ref` descriptor, and the browser streams the download separately.
- **Parse off the main thread.** The browser does `res.text()` + `JSON.parse` on the
  whole body; move parsing and mesh decoding into a Web Worker.

Structural — the keystone for everything in §2:

- **Async job model with results in object storage.** `POST /api/v1/compute`
  enqueues and returns a job ID; a worker solves and writes results to storage
  (small JSON manifest + binary blobs for meshes); the client is notified (polling
  or SSE) and downloads **directly from storage via presigned URL**, so the heavy
  bytes never transit the Node heap. Removes the memory wall, the solve-deadline
  ceiling, and the blocked event loop at once — and provides the queue that compute
  load balancing needs anyway.
- **Binary mesh encoding.** The plugin WebSocket path already streams binary mesh
  frames (SLVA); the cloud path should converge on the same encoding instead of
  JSON-with-base64. Draco or plain quantized buffers typically cut mesh size 5–10×
  before compression starts.

The relevant source: the solve pipeline
([solve-pipeline.ts](../../packages/solve/src/server/solve-pipeline.ts)) and the
compute route
([+server.ts](../../packages/selva/src/routes/api/v1/compute/+server.ts)).

## 2. Compute load balancing and autoscaling

The constraint: **pointer reuse and `cachesolve` are per compute server**. Naive
round-robin destroys both — every solve would re-upload a multi-MB `.gh`.

- **Definition-sticky routing.** Consistent-hash on definition ID across the pool,
  spilling to the least-loaded server when the home server saturates (accepting one
  re-upload). Keeps the pointer cache hot while spreading distinct definitions.
- **A real queue in the middle.** The job model above provides it. At current scale
  a Postgres-backed queue (`pg-boss` on the existing Supabase Postgres) is the
  low-ops choice. Queue depth per definition/server becomes the load signal,
  replacing the in-process FIFO
  ([engine.server.ts](../../packages/selva/src/lib/server/compute/engine.server.ts))
  — which dies with the Node process and can't span instances.
- **Wire the retry policy** `@selvajs/compute` already ships. Transient failures are
  routine when compute instances recycle.
- **Health-based eviction.** The status probe exists
  ([useServerHealth.svelte.ts](../../packages/selva/src/lib/composables/useServerHealth.svelte.ts));
  extend it so unhealthy servers leave the routing set automatically, not just show
  a badge in admin.

### Pool design: pin definitions to a group, not a server

- `ComputeServerGroup` in
  [IComputeServerStore](../../packages/platform/src/computeServer/interface.ts):
  shared config + member instances with health state. Existing single servers
  become groups of one.
- **Definition-sticky routing** (rendezvous hash on definition ID) inside the group.
  The pointer cache is in-memory per instance and McNeel does not support
  cross-instance pointer reuse. Spill to least-loaded on saturation; the client's
  transparent re-upload on `definition_not_cached` (VektorNode fork) makes a spill
  cost one re-upload, not an error.
- **Health eviction**: N failed probes → out of the routing set; `RetryPolicy` covers
  in-flight failures.
- **Autoscaler = control loop** over `IComputeInstanceController { start, stop,
status }` with cloud backends that start/stop **pre-provisioned** VMs — never
  create at scale-time — plus a no-op for static setups. Scale out on _sustained_
  queue depth (a Windows VM needs ~2–5 min to be useful); scale in by draining
  (unroute → finish in-flight → stop). Configurable warm floor. The scale signal is
  queue depth, so this hard-depends on the Phase 2 queue.

### Rhino 9 Linux (BETA)

[Rhino.Compute on Linux](https://developer.rhino3d.com/en/guides/compute/compute-linux-getting-started/)
is an official **BETA**: apt package on Ubuntu 24.04 / AmazonLinux 2023, systemd,
.NET 9, Docker works, core-hour-billing-only licensing. It would make autoscaling
cheap and fast — container boot in seconds, spot instances viable behind a queue +
retries. Not production-ready, and two Selva-specific blockers:

1. The **VektorNode fork must be ported** to the 9.x/Linux branch for block-instance
   support.
2. Only yak packages marked `-any` install, so Selva's yak packaging needs verifying.

Also: RhinoCode script components unsupported, file I/O 3dm-only. Run a prototype
spike now, and build the pool/controller design provider-agnostically so the backend
swap (Windows VMs → Linux containers) stays contained.

### Near-term stance: queue, fixed pool, routing — no image autoscaling

1. **Vertical first — it's free.** More cores + `--childcount` on the existing VM
   costs the same per core-hour as scaling out and needs zero routing work. Tune
   `--idlespan` so idle Rhino isn't billing.
2. **The queue is the real investment.** The async job model (§1) does double duty:
   it fixes the big-data path _and_ it's the prerequisite for any scaling automation.
   Anything built before the queue, an autoscaler can't use.
3. **Load balancing, the cheap kind.** A _fixed_ pool of 2–3 instances with
   definition-sticky routing and health eviction: static config plus routing logic in
   Selva, no cloud APIs, no image management — and it removes today's single-server
   point of failure.
4. **Caches: protect more than build.** Results are mostly unique, so the work is
   (a) not losing what exists — sticky routing keeps the pointer cache hot — and
   (b) the opt-in per-definition result cache (§3).

Image autoscaling is deferred because it's the highest-complexity item, it can't be
built well without queue metrics to drive it, and the Rhino 9 Linux BETA means the
infrastructure target likely looks different within ~6–12 months. The one thing to do
now on that track is the Linux prototype spike, since the fork port is the long-lead
item either way.

**2–3 fixed compute servers + sticky routing + a queue carries 5–50 users
comfortably.**

## 3. Caching when results are almost always unique

The operator page covers the measurement first: if the `selva_cache` hit rate is
low, spend elsewhere. The design work, when it is justified:

- **Durable result caching is per-definition opt-in, default off.** Only the
  definition author knows whether their definition is deterministic with an
  enumerable input space (dropdowns, value lists, stepped sliders), the profile where
  hit rates are high. Sketch: a `cachePolicy` field flat on `DefinitionRecord` (same
  precedent as the `computeServerId` pin); cache key =
  `SHA-256(version.id + canonicalized input tree)` — versions are immutable, so a
  re-upload mints a new version id and **invalidation is automatic**; entries stored
  via `IStorageProvider` under `solve-cache/{versionId}/{inputHash}`; checked in the
  route between input-tree build and `scheduler.solve`, written back asynchronously
  on miss. Guardrails: per-definition entry/byte budget with LRU sweep, slider values
  rounded to their step before hashing, prefix GC when live/draft re-points, and cache
  the result _before_ ADR 0003 file-output partitioning so entries never reference
  expired staged files.
- **Later: content-address output blobs** (key = hash of bytes). Even when a solve
  differs, often only some outputs changed — unchanged meshes dedupe in storage for
  free, and a client already holding a blob hash skips the download.

CDN helps only for _re-downloads_ of the same stored result (reopening a project, a
shared link).

## 4. Selva server scaling

For job-status pushes in the cloud path, **SSE** is sufficient and far easier behind
load balancers than a WebSocket.

The rate limiter is the one piece of in-process state that must change before a
second instance — the state sits behind `createComputeRateLimiter`
([rate-limit.ts](../../packages/server/src/compute/rate-limit.ts)) so a Redis
implementation slots in without touching call sites.

## Roadmap

| Phase | When            | Work                                                                                                                                                               |
| ----- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Now (cheap)     | Wire retries; file inputs via storage/multipart; browser parsing in a Web Worker; ship [ADR 0003](../adr/0003-large-file-output-streaming.md); Rhino 9 Linux spike |
| 2     | Next (keystone) | Async job model: queue + worker + results-to-storage + presigned downloads + binary mesh encoding (needs its own ADR)                                              |
| 3     | Then            | Multiple compute servers behind definition-sticky routing with health-based eviction; collect queue-depth metrics                                                  |
| 4     | When justified  | Warm-pool compute autoscaling; horizontal Selva instances; content-addressed output blobs                                                                          |

Each phase ends with a measurement checkpoint: `Server-Timing` breakdowns and the
solve-metric sink already record where time and bytes go — let them pick the next
bottleneck rather than this document.
