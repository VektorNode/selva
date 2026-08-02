# `server/` — the solve core behind the wire

Given a resolved solve context — the `.gh` bytes, the input params + user values, and a warm
scheduler — this half runs a solve and returns a ready-to-send envelope:

```
input tree build → scheduler.solve → JSON serialize (size-guarded) → gzip → Server-Timing
```

`runSolvePipeline` returns a discriminated `SolveOutcome`. `ok` carries the envelope (body, headers,
phase metrics); `timeout`, `client_abort`, `too_large`, `shed` (rejected under backpressure) and
`compute_error` each name a
failure the transport maps to its own status code. **Nothing here throws for an expected failure**,
and nothing here touches auth, the database, share tokens, rate limits or metric sinks — those stay
app policy in the route.

## Contents

| File                           | Owns                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `solve-pipeline.ts`            | `runSolvePipeline` — the whole chain above, plus the wire contract version |
| `transform-input.ts`           | one schema input + user value → an `InputParam` the tree builder takes     |
| `client-cache.ts`              | per-server warm Rhino.Compute client + scheduler, id-keyed LRU             |
| `definition-byte-cache.ts`     | `.gh` bytes by immutable version id, total-byte-budget LRU                 |
| `solve-cache-single-flight.ts` | dogpile protection: concurrent identical solves share one flight           |

## Node-only, and that is load-bearing

This half reads `node:zlib`, `node:crypto` and `process.env`, and its cache backends take platform
providers. **It must never be reachable from `client/`.** Three guards, none of them ceremony:

1. **No root barrel.** The package exports `./client`, `./server`, `./shared` and nothing at `.`.
2. **eslint `no-restricted-imports`** — `src/client/**` may not import `../server/*`,
   `@selvajs/platform`, `@selvajs/server*` or `node:*`.
3. **A bundle test** on the shipped `dist/client.js`
   ([`../__tests__/client-bundle-boundary.test.ts`](../__tests__/client-bundle-boundary.test.ts)) —
   the only check that sees through the bundler rather than reading source.

Anything both halves need goes in `shared/`, and must stay runtime-neutral.

## Cache tiers

Two caches sit on this path; they are separate on purpose and fail independently.

| Where                        | Keyed on                                        | Scope           |
| ---------------------------- | ----------------------------------------------- | --------------- |
| `client/solve-memo.ts`       | sorted-key JSON of raw input values             | one browser tab |
| `@selvajs/compute` scheduler | 32-bit FNV of the definition + transformed tree | one process     |

There is no durable tier beyond these today. The in-memory backend that used to sit here was
deleted as redundant with the scheduler's cache (same heap, consulted second); what survives is the
`ISolveResultCache` seam in `@selvajs/platform`, where a shared backend (Redis) mounts if horizontal
scaling ever demands one.

Single-flight coalesces on `version:server:` + the **transformed** input tree — the same identity
the scheduler caches on — so two raw-different but transform-identical requests share one flight.

## The Server-Timing string is a wire contract

`COMPUTE_CONTRACT_VERSION` + `COMPUTE_VERSION_HEADER` version the response shape (body + phases). It
rides an additive header so a client can branch on it with no change to the body. Bump it — and
document the change — whenever the envelope changes in a way a consumer could observe.

## Relationship to `@selvajs/server/compute`

These files used to live in `@selvajs/server/compute`. That sub-path now keeps only what is
genuinely HTTP _request policy_ — rate limiting, the SSRF guard, env-derived limits, the
remote-definition fetcher — with no re-export of anything here, and no dependency on
`@selvajs/solve` at all. The two packages are independent; importing solve-core from
`@selvajs/server` is a breaking change for consumers on `0.2.x` (`.changeset/solve-server-half.md`).
