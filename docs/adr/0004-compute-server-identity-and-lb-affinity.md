# ADR 0004 — Compute-Server Identity is the ID; Solves Route by Definition Affinity

> **Status: Accepted (2026-07-08). Its two K2 invariants are implemented; the load balancer itself
> is still unbuilt.** Establishes two forward-compatible invariants ahead of extracting the compute
> stack into [`@selvajs/server`](../../packages/server/) (the former
> `docs/plans/embeddable-server-layer.md` tracker, items K1–K3; deleted 2026-07-13 once its work
> shipped): (1) a compute **server's identity is its `id`, never its URL**; (2) when cross-VM load
> balancing arrives, solves **route by definition-guid affinity**, not round-robin. Both landed in
> K2 (id-keyed cache with an explicit config-write eviction hook; `X-Selva-Definition` on the wire)
> — see Sequencing. Neither the LB, autoscaling, nor pool membership is built here. This ADR exists
> so the code written between now and then — most importantly the `getClient(...)` API that K2 makes
> public — doesn't bake in an identity scheme that a later semver-minor can't change.
>
> **Where the code landed:** the warm-client cache lives in
> [`packages/solve/src/server/client-cache.ts`](../../packages/solve/src/server/client-cache.ts)
> (`@selvajs/solve/server`), not in `@selvajs/server` as the K-tracker names below imply.
> `@selvajs/server/compute` holds the limits, rate limit, and SSRF guard.

## Problem

Two decisions must be made **before** the compute stack is published as a library, because both
become public API surface the moment K2 ships `getClient(...)` and would be semver-breaking to change
afterward.

### 1. What identifies a compute server?

Today the shared client cache keys the warm `GrasshopperClient` + `SolveScheduler` LRU on the
server's **URL + API key**:

```ts
// clientCache.server.ts:73-75
function clientCacheKey(serverConfig: ComputeServerConfig): string {
	return `${serverConfig.serverUrl} ${serverConfig.apiKey ?? ''}`;
}
```

This is fine as a private in-process detail. But the package extraction (K2) turns `getClient` into
**published API** — `getClient(serverIdentity)`. If the identity is `serverUrl + apiKey`, then the
day a "server" becomes a _pool of URLs behind one id_ (the whole point of cross-VM balancing), every
caller keyed on URL is wrong, and the fix is a breaking change to a 0.x→1.x-defining API.

The data model is already right: pins, org defaults, and shares all reference a server **`id`**
([types.ts:18](../../packages/platform/src/computeServer/types.ts#L18)), never a URL. `serverUrl` is
one field _inside_ the resolved config ([types.ts:21](../../packages/platform/src/computeServer/types.ts#L21)).
Only the runtime plumbing — the client cache, and any metrics/logs that grew up alongside it — treats
the URL as identity. That's the one-way door to close.

### 2. How will solves distribute across VMs when there's more than one?

Rhino.Compute already balances _within_ a VM (the frontend spawns N `compute.geometry` children).
The missing layer is **cross-VM**, and a naive HTTP LB (nginx round-robin) would actively hurt this
system — it isn't a neutral default we can adopt later without cost:

- The **definition pointer cache** (`COMPUTE_REUSE_DEFINITION_CACHE`) is per-VM. Round-robin sends
  every other solve to a VM without the cached definition — transparent re-upload thrash on the
  VektorNode fork, or the **silent-empty-geometry** failure mode on a standard rhino.compute
  ([computeLimits.ts](../../packages/selva/src/lib/server/computeLimits.ts)). An LB without affinity
  turns a known edge case into routine behavior.
- The **`cachesolve` result cache** is per-VM — hit rate divided by N under random routing.
- Solves are long (up to 100s) and wildly variable — round-robin stacks two heavy solves on one VM
  while another idles.

Both server-side caches key on the **definition**. So the routing law is forced: **a solve must route
by definition affinity** (hash the definition guid → pool member). Whoever routes — an infra LB or the
app — needs the definition identity _at routing time_, before the POST body is parsed.

## Decision

### D1 — A compute server's identity is its `id`. URLs are a resolution detail.

New code — caches, metrics, logs, and every published API — keys on the server `id`, never on
`serverUrl` (or `serverUrl + apiKey`). The URL is what an id _resolves to_ at call time and may later
become a _set_ of URLs without touching any stored reference or any cache key.

Concretely, before K2 publishes:

- The client-cache key changes from `serverUrl + apiKey` to the server `id`. Staleness (an operator
  rotating a URL/key via `/admin/compute`) is then handled by **explicit invalidation on config
  write**, not by the key silently changing — see Consequences.
- K2 exports `getClient(serverIdentity)` where `serverIdentity` is an **opaque type** from day one
  (a branded `string`, or `{ id: string }`), so a later change to what an identity contains is not
  an API break.
- `ComputeServerConfig` staying `{ id, serverUrl, apiKey, ... }` is unchanged. Pool membership, when
  it lands, is an **additive** change (`urls: string[]`, or member rows resolved by `id`) — no schema
  break, because nothing stored ever referenced a URL.

### D2 — Solves route by definition-guid affinity. Put the guid on the wire now.

Every solve / `getIO` request to a compute server carries the definition guid as a header
(`X-Selva-Definition`). This is the whole forward-compatibility purchase: it lets **any** future router
— nginx `hash ... consistent`, a cloud LB, or app-level pool selection — do definition affinity without
parsing the solve POST body.

> **Implementation note (K2):** this was _not_ one line — the published `@selvajs/compute` client owned
> its own `fetch` with no header seam, so K2 first added an optional `ComputeConfig.headers` hook to the
> client (merged _under_ the transport's own `RhinoComputeKey`/`Authorization`/`X-Request-ID` so a
> caller can never clobber auth), then set it at client-create time in `createClientCache`. Because the
> warm client is per-server and the `SolveScheduler` has no per-request header option, the guid is fixed
> for a given warm client's lifetime rather than truly per-request — which is correct for the routing law
> below (a router picks the pool member from the guid _before_ `getClient`, so within one member the
> header is inert metadata anyway).

The routing law is recorded, not implemented: when a pool exists,
`member = hash(definitionGuid) mod poolSize` with a liveness fallback. Until then there is exactly one
member and the header is inert metadata (also useful in compute-side access logs immediately).

### What is explicitly NOT decided / built here

- **The load balancer itself, autoscaling, cross-instance admission control, a queue service** — all
  deferred until real demand. At current scale none of it pays.
- **App-level pooling vs. an infra LB** — leaning app-level when the time comes (the app already holds
  per-server schedulers with queue-depth awareness, the API-key-per-server model doesn't fit a shared
  LB URL cleanly, and per-org quotas/metering want the same decision point), but this ADR keeps both
  doors open by putting the affinity key on the wire rather than committing to a router.
- **Health-probe-driven pool liveness** — the passive per-server probing
  (`admin/api/compute/status`) becomes the liveness source later; no change now.

## Consequences

### Good

- `getClient(...)` can be published (K2) without gambling the identity scheme: opaque id from day
  one means "a server is now a pool" is an additive, non-breaking evolution.
- The affinity key (`X-Selva-Definition`) is on the wire before any router needs it, so the LB — infra
  or app — becomes a contained, deferred change instead of a wire-format migration under load.
- Keying the client cache on `id` fixes a latent coupling: metrics/logs/caches that key on URL would
  fragment the moment one server resolves to several URLs.

### Costs / risks

- **Cache invalidation moves from implicit to explicit.** Before this ADR, rotating a server's URL or
  key produced a _new_ cache key, so the stale warm client simply aged out via LRU. Keying on `id`
  means a rotated URL keeps the _same_ key with stale connection details — so the config-write path
  (`savePlatformServers`/`saveOrgServers`) must **evict the entry for that `id`** (dispose its
  scheduler). This is a small, explicit invalidation hook and is the one line that must land _with_
  the key change, not after. Tracked as the concrete first step of K2.
- **`X-Selva-Definition` is a new outbound header.** It must not collide with anything the VektorNode
  fork already reads; verified against the fork's request handling before shipping. Worst case it is
  ignored, which is the correct behavior for a single-member "pool".
- **A branded/opaque identity type adds a hair of ceremony** at call sites vs. passing a bare string.
  Accepted: it is exactly the ceremony that makes the type future-proof.

## Sequencing

This ADR gated K2, the client-cache extraction out of the app:

1. **Now (this ADR):** decision recorded. No code required to _accept_ it.
2. **✅ Done with K2 (2026-07-08), as part of the extraction:**
   - ✅ Client-cache key changed from `serverUrl + apiKey` to server `id`
     ([client-cache.ts](../../packages/solve/src/server/client-cache.ts)).
   - ✅ Config-write eviction hook added
     ([`evictChangedServers`](../../packages/selva/src/lib/server/compute/evictChangedServers.ts)),
     called from the admin + org compute PUT routes; disposes the scheduler for a rotated/removed `id`.
   - ✅ `getClient` takes an opaque `ServerIdentity`; `evict`/`disposeAll` exported.
   - ✅ `X-Selva-Definition` emitted on solve / `getIO` — via a new `ComputeConfig.headers` hook in
     `@selvajs/compute` (see the D2 implementation note). The publish gate named here is closed:
     `@selvajs/compute` is a workspace package in this repo (currently 4.x), not an external pin.
3. **Deferred until demand:** pool membership on `ComputeServerConfig` (additive), the router
   (`resolveServerForOrg` returns members + pick-by-hash with liveness fallback), the LB/autoscaling.

## TL;DR

- Two invariants must be fixed **before** `getClient(...)` becomes public API (K2), because both are
  semver-breaking to change afterward.
- **Identity is the `id`, never the URL.** The stored model already obeys this; the client cache and
  future published API must too. `getClient` takes an **opaque** identity from day one; the cache keys
  on `id`; config-write explicitly evicts on rotation, replacing the implicit key-change staleness.
- **Solves route by definition-guid affinity**, never round-robin — both compute-side caches key on
  the definition. Put the guid on the wire now (`X-Selva-Definition`); build the actual router later.
- Everything else — the LB, pools, autoscaling — is deferred. This ADR only keeps the doors open.
