# ADR 0004: Compute-Server Identity is the ID; Solves Route by Definition Affinity

> **Status: Accepted (2026-07-08). Both invariants are implemented; the load balancer is not built.**
> Two forward-compatible invariants, set while extracting the compute stack into
> [`@selvajs/server`](../../packages/server/): (1) a compute **server's identity is its `id`, never its
> URL**; (2) when cross-VM load balancing arrives, solves **route by definition-guid affinity**, not
> round-robin. Neither the LB, autoscaling, nor pool membership is built. The ADR exists so code written
> before then, most importantly the `getClient(...)` API, doesn't bake in an identity scheme that a
> later semver-minor can't change.
>
> The warm-client cache lives in
> [`packages/solve/src/server/client-cache.ts`](../../packages/solve/src/server/client-cache.ts)
> (`@selvajs/solve/server`). `@selvajs/server/compute` holds the limits, rate limit, and SSRF guard.

## Problem

Both decisions had to be made **before** the compute stack was published as a library: they become
public API surface the moment `getClient(...)` is public, and would be semver-breaking to change
afterward.

### 1. What identifies a compute server?

The shared client cache keyed the warm `GrasshopperClient` + `SolveScheduler` LRU on the server's
**URL + API key**. That is fine as a private in-process detail. Once `getClient` is published, though,
the day a "server" becomes a _pool of URLs behind one id_ (the whole point of cross-VM balancing),
every caller keyed on URL is wrong, and the fix is a breaking change.

The data model is already right: pins, org defaults, and shares all reference a server **`id`**
([types.ts](../../packages/platform/src/computeServer/types.ts)), never a URL. `serverUrl` is one field
_inside_ the resolved config. Only the runtime plumbing (the client cache, and any metrics/logs that
grew up alongside it) treats the URL as identity. That's the one-way door to close.

### 2. How will solves distribute across VMs when there's more than one?

Rhino.Compute already balances _within_ a VM (the frontend spawns N `compute.geometry` children).
The missing layer is **cross-VM**, and a naive HTTP LB (nginx round-robin) would actively hurt this
system: it isn't a neutral default we can adopt later without cost.

- The **definition pointer cache** (`COMPUTE_REUSE_DEFINITION_CACHE`) is per-VM. Round-robin sends
  every other solve to a VM without the cached definition, causing transparent re-upload thrash on the
  VektorNode fork, or the **silent-empty-geometry** failure mode on a standard rhino.compute
  ([limits.ts](../../packages/server/src/compute/limits.ts)). An LB without affinity
  turns a known edge case into routine behavior.
- The **`cachesolve` result cache** is per-VM, so hit rate is divided by N under random routing.
- Solves are long (up to 100s) and wildly variable, so round-robin stacks two heavy solves on one VM
  while another idles.

Both server-side caches key on the **definition**. So the routing law is forced: **a solve must route
by definition affinity** (hash the definition guid to a pool member). Whoever routes, an infra LB or the
app, needs the definition identity _at routing time_, before the POST body is parsed.

## Decision

### D1: A compute server's identity is its `id`. URLs are a resolution detail.

New code (caches, metrics, logs, and every published API) keys on the server `id`, never on
`serverUrl` (or `serverUrl + apiKey`). The URL is what an id _resolves to_ at call time and may later
become a _set_ of URLs without touching any stored reference or any cache key.

- The client-cache key is the server `id`. A rotated URL/key now keeps the same key, so staleness is
  handled by **explicit invalidation on config write**, not by the key silently changing; see
  Consequences.
- `getClient` takes the `{ id, serverUrl, apiKey }` object and `evict` takes the `id`. A branded opaque
  identity type was dropped: with `id` as the key, pool membership stays additive without one.
- `ComputeServerConfig` staying `{ id, serverUrl, apiKey, ... }` is unchanged. Pool membership, when
  it lands, is an **additive** change (`urls: string[]`, or member rows resolved by `id`); no schema
  break, because nothing stored ever referenced a URL.

### D2: Solves route by definition-guid affinity. Put the guid on the wire now.

Every solve / `getIO` request to a compute server carries the definition guid as a header
(`X-Selva-Definition`). This is the whole forward-compatibility purchase: it lets **any** future router,
whether nginx `hash ... consistent`, a cloud LB, or app-level pool selection, do definition affinity without
parsing the solve POST body.

The published `@selvajs/compute` client owns its own `fetch`, so it got an optional
`ComputeConfig.headers` hook, merged _under_ the transport's own `RhinoComputeKey`/`Authorization`/
`X-Request-ID` so a caller can never clobber auth. The cache sets it when it creates the warm client.
The `SolveScheduler` has no per-request header option, so the guid is fixed for that client's lifetime
rather than truly per-request. That is correct for the routing law below: a router picks the pool
member from the guid _before_ `getClient`, so within one member the header is inert metadata anyway.

The routing law is recorded, not implemented: when a pool exists,
`member = hash(definitionGuid) mod poolSize` with a liveness fallback. Until then there is exactly one
member and the header is inert metadata. Don't read it in access logs: every solve on a warm client
carries the guid of the first definition that client served.

### What is explicitly NOT decided / built here

- **The load balancer itself, autoscaling, cross-instance admission control, a queue service:** all
  deferred until real demand. At current scale none of it pays.
- **App-level pooling vs. an infra LB:** leaning app-level when the time comes (the app already holds
  per-server schedulers with queue-depth awareness, the API-key-per-server model doesn't fit a shared
  LB URL cleanly, and per-org quotas/metering want the same decision point), but this ADR keeps both
  doors open by putting the affinity key on the wire rather than committing to a router.
- **Health-probe-driven pool liveness:** the passive per-server probing
  (`/api/admin/compute/status`) becomes the liveness source later; no change now.

## Consequences

### Good

- `getClient(...)` keys on the `id`, so "a server is now a pool" is an additive, non-breaking
  evolution.
- The affinity key (`X-Selva-Definition`) is on the wire before any router needs it, so the LB (infra
  or app) becomes a contained, deferred change instead of a wire-format migration under load.
- Keying the client cache on `id` fixes a latent coupling: metrics/logs/caches that key on URL would
  fragment the moment one server resolves to several URLs.

### Costs / risks

- **Cache invalidation is explicit.** Keying on `id` means a rotated URL keeps the _same_ key with
  stale connection details, so it never ages out via LRU. The config-write path must **evict the entry
  for that `id`** (dispose its scheduler):
  [`evictChangedServers`](../../packages/server/src/compute/evict-changed-servers.ts) diffs the old and
  new server sets, and the admin and org compute write routes call it.
- **`X-Selva-Definition` is a new outbound header.** It must not collide with anything the VektorNode
  fork already reads; verified against the fork's request handling before shipping. Worst case it is
  ignored, which is the correct behavior for a single-member "pool".
