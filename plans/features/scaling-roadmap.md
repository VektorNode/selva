# Scaling roadmap

**Not tracked as an issue.** File one when a limit shows up in real usage.

Design notes for lifting the limits in
[docs/self-hosting/deployment/scaling.md](../../docs/self-hosting/deployment/scaling.md); read that page
first for where the architecture stands. Unless a section says otherwise, nothing here is built.

## 1. Moving big data

**Pass big data by reference, not by value.** `IStorageProvider` only has `getPublicUrl` (a CDN
URL or an authenticated `/api/files/` proxy path). No provider issues presigned upload or
download URLs, so each direct-to-storage step below needs a new interface method first.

Near-term, no architecture change:

- **File inputs stop being base64-in-JSON.** Client uploads to storage first (or
  `multipart/form-data`), then references the blob in the solve request. Cuts the wire size by
  a quarter (base64 inflates by a third) and removes a 100 MB string from the JSON body.
- **File outputs go out-of-band** ([ADR 0003](../../docs/adr/0003-large-file-output-streaming.md),
  proposed): large `file` outputs stage to storage, the solve response carries a small
  `file-ref` descriptor, and the browser streams the download separately.
- **Parse off the main thread.** The browser does `res.text()` + `JSON.parse` on the whole
  body; move parsing and mesh decoding into a Web Worker.

Structural: the keystone for everything in §2:

- **Async job model with results in object storage.** `POST /api/v1/compute` (today:
  [solve-pipeline.ts](../../packages/solve/src/server/solve-pipeline.ts) behind the
  [compute route](../../packages/selva/src/routes/api/v1/compute/+server.ts)) enqueues and
  returns a job ID; a worker solves and writes results to storage (small JSON manifest + binary
  blobs for meshes); the client is notified (polling or SSE) and downloads **directly from
  storage via presigned URL**, so the heavy bytes never transit the Node heap. Removes the
  memory wall, the solve-deadline ceiling, and the blocked event loop at once, and provides the
  queue that compute load balancing needs anyway.
- **Binary mesh encoding.** The plugin WebSocket path already streams binary mesh frames
  (SLVA); the cloud path should converge on the same encoding instead of JSON-with-base64.
  Draco or plain quantized buffers typically cut mesh size 5-10x before compression starts.

## 2. Compute load balancing and autoscaling

The constraint: **pointer reuse and `cachesolve` are per compute server**. Naive round-robin
destroys both: every solve would re-upload a multi-MB `.gh`.

Scale one server vertically first (cores, `--childcount`, `--idlespan`): it costs the same per
core-hour as scaling out and needs no routing work. Then, in this order:

1. **A fixed pool of 2-3 servers.** Static config plus routing logic in Selva: no cloud APIs, no
   image management, and it removes today's single-server point of failure. With the queue
   below, it should carry 5-50 users comfortably.
2. **A real queue in the middle.** The job model above provides it, and it is the prerequisite
   for any scaling automation: an autoscaler can't use anything built before it. At current
   scale a Postgres-backed queue (`pg-boss` on the existing Supabase Postgres) is the low-ops
   choice. Queue depth per definition/server becomes the load signal, replacing the in-process
   FIFO (`SolveQueue` in
   [solve-scheduler.ts](../../packages/compute/src/grasshopper/scheduler/solve-scheduler.ts)),
   which dies with the Node process and can't span instances.
3. **Autoscaling**, last, once queue metrics exist to drive it.

### Pool design: pin definitions to a group, not a server

- **`ComputeServerGroup`** in
  [IComputeServerStore](../../packages/platform/src/computeServer/interface.ts): shared config
  plus member instances with health state. Existing single servers become groups of one.
- **Definition-sticky routing** inside the group, by definition guid per
  [ADR 0004](../../docs/adr/0004-compute-server-identity-and-lb-affinity.md), which already puts the
  guid on the wire as `X-Selva-Definition`. The pointer cache is in-memory per instance and
  McNeel does not support cross-instance pointer reuse. When a home server saturates, spill to
  the least-loaded one: the client's transparent re-upload on `definition_not_cached`
  (VektorNode fork) makes a spill cost one re-upload, not an error. ADR 0004 records
  `hash(guid) mod poolSize`; once the pool can resize, use consistent or rendezvous hashing so a
  membership change doesn't remap every definition.
- **Health eviction**: N failed probes take a server out of the routing set; the retry policy
  covers in-flight failures. The existing probe
  ([useServerHealth.svelte.ts](../../packages/selva/src/lib/composables/useServerHealth.svelte.ts))
  is operator-initiated and never polls, on purpose: a background poll would wake and bill
  idle servers. Eviction can't simply poll it on a timer.
- **Wire the retry policy** `@selvajs/compute` already ships. It defaults to `attempts: 0` and
  Selva sets nothing, so no solve retries today. Transient failures are routine when compute
  instances recycle.
- **Autoscaler = control loop** over `IComputeInstanceController { start, stop, status }` with
  cloud backends that start/stop **pre-provisioned** VMs (never create at scale-time), plus a
  no-op for static setups. Scale out on _sustained_ queue depth (a Windows VM needs ~2-5 min to
  be useful); scale in by draining (unroute, finish in-flight, stop). Configurable warm floor.
  It is the most complex piece, and the Rhino 9 Linux beta below probably changes the
  infrastructure target within ~6-12 months, so don't build it first.

### Rhino 9 Linux (BETA)

[Rhino.Compute on Linux](https://developer.rhino3d.com/en/guides/compute/compute-linux-getting-started/)
is an official **BETA** with core-hour-billing-only licensing; RhinoCode script components are
unsupported and file I/O is 3dm-only. It would make autoscaling cheap and fast: containers
boot in seconds, and spot instances are viable behind a queue plus retries. Two Selva-specific
blockers:

1. The **VektorNode fork must be ported** to the 9.x/Linux branch for block-instance support.
2. Only yak packages marked `-any` install, so Selva's yak packaging needs verifying.

Run a prototype spike now, since the fork port is the long-lead item either way, and build the
pool/controller design provider-agnostically so the backend swap (Windows VMs to Linux
containers) stays contained.

## 3. Caching when results are almost always unique

The operator page covers the measurement first: if the `selva_cache` hit rate is low, spend
elsewhere. Protect what exists before building more: sticky routing keeps the pointer cache hot.

- **Durable result caching is per-definition opt-in.** Only the definition author knows whether
  a definition is deterministic with an enumerable input space (dropdowns, value lists, stepped
  sliders), the profile where hit rates are high. The seam exists but nothing calls it:
  [`ISolveResultCache`](../../packages/platform/src/solveCache/interface.ts) is keyed on
  `(orgId, definitionId, versionId, inputKey)`, with `inputKey` a SHA-256 of the transformed
  input tree plus the solve-affecting config, and evicts LRU within a definition. The
  `solveCacheLimit` field on `DefinitionRecord` is its quota (`0` = off); the definition stores
  persist it and nothing reads it. Only `NoopSolveResultCache` ships. Versions are immutable,
  so a re-upload mints a new version id and **invalidation is automatic**. Still to design: a
  backend (blobs via `IStorageProvider` under `solve-cache/{versionId}/{inputHash}`, or Redis);
  the call site, between input-tree build and `scheduler.solve`, writing back asynchronously on
  miss; rounding slider values to their step before hashing; and caching the result _before_
  ADR 0003 file-output partitioning so entries never reference expired staged files.
- **Later: content-address output blobs** (key = hash of bytes). Even when a solve differs,
  often only some outputs changed: unchanged meshes dedupe in storage for free, and a client
  already holding a blob hash skips the download.

CDN helps only for _re-downloads_ of the same stored result (reopening a project, a shared
link).

## 4. Selva server scaling

For job-status pushes in the cloud path, **SSE** is sufficient and far easier behind load
balancers than a WebSocket.

Three pieces of in-process state change before a second instance:

- **The rate limiter.** It sits behind `createComputeRateLimiter`
  ([rate-limit.ts](../../packages/server/src/compute/rate-limit.ts)), so a Redis implementation
  slots in without touching call sites.
- **The live solve-event bus**
  ([bus.server.ts](../../packages/selva/src/lib/server/solveEvents/bus.server.ts)). A second
  instance needs sticky sessions or a shared `SolveEventBus` implementation.
- **The idempotency store**
  ([idempotency.ts](../../packages/server/src/compute/idempotency.ts)). A retry that lands on
  another instance re-solves: it costs compute, not correctness.

`Server-Timing` and the solve-metric sink already record where time and bytes go. Let them pick
the next bottleneck rather than this document.
