---
title: Scaling
order: 8
published: true
description: 'Current limits of the compute and data path, and how to tune a deployment against them.'
---

# Scaling

Where the architecture hits its limits as usage grows, and what you can tune
today. The staged plan for lifting these limits is internal;
see `docs/contributing/scaling-roadmap.md` in the repository.

## Where we stand today

One solve request, synchronous end to end:

```
Browser ──HTTP POST /api/v1/compute──► Selva server ──HTTP──► Rhino.Compute
        ◄────── full JSON result ──┘            ◄── JSON ──┘
```

- The client never talks to Rhino.Compute directly. The Selva server proxies
  everything and holds the compute URL + API key.
- The full `.gh`, the full input tree, and the full result are each **buffered
  whole in Node memory**, then `JSON.stringify`-ed once. Gzip is already async, so
  compression no longer blocks the event loop, but the buffered `JSON.stringify`
  still does, and it is why `COMPUTE_RESPONSE_MAX_BYTES` caps at 300 MB, under
  V8's ~512 MB single-string ceiling.
- File/geometry **inputs and outputs travel as base64 inside JSON** (~4/3
  inflation).
- Multiple compute servers are supported, but resolution is **pinning, not load
  balancing**: each definition resolves to exactly one server, with a per-server
  in-process FIFO queue.
- Caches already stack; see [Caching](./caching.md). **Pointer reuse and
  `cachesolve` are per compute server.**
- `Server-Timing` on every solve plus per-attempt solve metrics tell you which
  limit you are actually hitting. Measure before you tune.

### What breaks first, in order

| #   | Bottleneck                                            | Symptom                                                            |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `JSON.stringify` of ~100 MB bodies on the main thread | One big solve stalls every concurrent request on the Node server   |
| 2   | Base64-in-JSON for large file outputs                 | ~1 GB browser-tab memory per solve; server hits the V8 string wall |
| 3   | Single compute server per definition, no retries      | Queue buildup; transient failures surface to users                 |
| 4   | Synchronous request/response, 100 s solve deadline    | Long solves impossible; connections held open under load           |
| 5   | In-process queue and caches                           | Can't run a second Selva instance without losing them              |

## How one server scales (do this first)

`rhino.compute` is a thin frontend that **round-robins** across `compute.geometry`
children, each a full headless Rhino. CLI args: `--childcount` (default 4, cap 64),
`--idlespan` (default 3600 s; children self-terminate when idle and **billing
stops**), `--spawn-on-startup` to pre-warm. Max out cores + children on one VM
before adding VMs. `RHINO_COMPUTE_MAX_REQUEST_SIZE` defaults to ~50 MB and must be
raised for large payloads; it is also why `MAX_DEFINITION_FILE_SIZE_BYTES` defaults
to 50 MB.

## Licensing and cost

[Core-Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/):
**$0.10 per core per hour, billed on Rhino uptime, not usage** (an idle 8-core VM
≈ $576/mo). Per **core**, not per instance: 64 children on one box cost the same as

1. **One `RHINO_TOKEN` licenses the whole fleet**; treat it as a secret, it bills
   your card. Scaling out is licensing-trivial; the cost lever is scaling back down
   (idlespan + stopping VMs).

## Caching expectations

When outputs are unique per input, result caching has near-zero hit rate no matter
how clever the cache. What already helps is caching the stable upstream artifacts:
definition bytes, pointer reuse, warm clients ([Caching](./caching.md)).

Before assuming a result cache would help, measure the hit rate via the
`selva_cache` Server-Timing metric and the `/admin/compute` caching panel. If it is
low (likely, for unique outputs), the lever for large payloads is transfer
efficiency, not caching.

## Networking

- Client ↔ Selva stays HTTPS. The WebSocket stays plugin-local, bound to loopback.
- Put compute servers, the Selva server, and storage **in the same VPC/region**:
  the server ↔ compute hop carries the fattest payloads, and internal traffic can
  skip compression entirely.
- The Selva server is nearly stateless under Supabase; the local provider is
  single-instance by design.

## Running a second Selva instance

In-process state is what blocks it: the FIFO queue, the warm-client LRU, the
definition and solve caches, and the fixed-window rate limiter. The caches are
acceptable per-instance, where a split costs only hit rate.

**The rate limiter is the exception, and needs a decision before instance two.**
Splitting its buckets across N instances doesn't degrade a cache; it multiplies
the enforced rate by N, since each instance independently admits a full window per
key. Either accept N× and size `COMPUTE_RATE_LIMIT_MAX` accordingly, or move the
limiter to a shared store. Memory growth is already handled: buckets self-evict.
