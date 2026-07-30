# `server/` — the solve core behind the wire

Given a resolved solve context — the `.gh` bytes, the input params + user values, and a warm
scheduler — this half runs a solve and returns a ready-to-send envelope:

```
input tree build → L2 lookup → scheduler.solve → JSON serialize (size-guarded) → gzip → Server-Timing
```

`runSolvePipeline` returns a discriminated `SolveOutcome`. `ok` carries the envelope (body, headers,
phase metrics); `timeout`, `client_abort`, `too_large`, `shed` and `compute_error` each name a
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
| `memory-solve-cache.ts`        | the in-memory L2 backend (`ISolveResultCache`)                             |
| `solve-cache-key.ts`           | L2 key derivation — SHA-256 over the transformed tree + config subset      |
| `solve-cache-envelope.ts`      | the stored L2 entry format (header + gzipped body)                         |
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

Three caches sit on this path; they are separate on purpose and fail independently.

| Tier | Where                            | Keyed on                                              | Scope               |
| ---- | -------------------------------- | ----------------------------------------------------- | ------------------- |
| M2   | `client/solve-memo.ts`           | sorted-key JSON of raw input values                   | one browser tab     |
| L1   | `@selvajs/compute` scheduler     | 32-bit FNV of the scheduler's identity                | one process         |
| L2   | `solve-cache-key.ts` + a backend | SHA-256 over the **transformed** tree + config subset | durable, cross-user |

**L2's key strength is not stylistic.** A collision serves one user's geometry to another, and that
already shipped once (see the file header). L1's 32-bit FNV is fine for a 20-entry in-process Map;
the two are deliberately not interchangeable, and Phase 5 of the plan unifies their _derivation_
without flattening their strength.

Single-flight coalesces on the raw `{inputs, values}` while L2 keys on the transformed tree, so two
raw-different but transform-identical inputs run as separate flights and then hit the same L2 key.
Known, recorded in the caching audit (§F2), and reconciled in Phase 5 rather than blindly.

## The Server-Timing string is a wire contract

`COMPUTE_CONTRACT_VERSION` + `COMPUTE_VERSION_HEADER` version the response shape (body + phases). It
rides an additive header so a client can branch on it with no change to the body. Bump it — and
document the change — whenever the envelope changes in a way a consumer could observe.

## Relationship to `@selvajs/server/compute`

These files lived there until Phase 3 of
[the solve-package plan](../../../../docs/plans/solve-package.md). That sub-path keeps what is
genuinely HTTP _request policy_ — rate limiting, the SSRF guard, env-derived limits, the
remote-definition fetcher — and is now **10 exports that it actually owns**, with no re-export of
anything here.

The move briefly shipped a compatibility shim (`@selvajs/server/compute` re-exporting all of this).
It was removed before release: it left `/compute` at 24 exports of which 14 were borrowed, so the
package's surface no longer described what the package did — the exact problem the extraction was
meant to fix. `@selvajs/server` no longer depends on `@selvajs/solve` at all; the two are
independent. Importing solve-core from `@selvajs/server` is a breaking change for consumers on
`0.2.x`, called out in the changeset.
