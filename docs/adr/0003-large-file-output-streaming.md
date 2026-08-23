# ADR 0003: Large file outputs travel out-of-band, not inside the solve JSON

> **Status: PROPOSED (2026-06-03).** A `file`-typed Grasshopper output (e.g. an exported
> `.3dm`) is base64-embedded inside the `/api/v1/compute` JSON response today. Real definitions
> produce 250+ MB exports. That single payload, base64-inflated and copied four-to-five times
> across the serialize → transfer → parse → extract → download chain, both approaches the V8
> string-length ceiling on the server and balloons browser-tab memory toward ~1 GB per solve.
> This ADR moves large file outputs **out of the solve JSON**: the solve response carries
> small geometry/meshes + a **reference** to each file output; the browser fetches the file as a
> separate binary stream on demand.
>
> **Still unimplemented as of 2026-08.** No `file-ref` descriptor, no `compute-staging/` prefix, and
> no `/api/v1/compute/files/…` route exists. One piece landed on its own: the response guard
> `COMPUTE_RESPONSE_MAX_BYTES` is live in
> [`@selvajs/server/compute`](../../packages/server/src/compute/limits.ts), defaulting to 300 MB
> rather than the ~25 MB this ADR proposed; it currently backstops the un-partitioned payload
> instead of a partitioned one. `COMPUTE_INLINE_FILE_MAX_BYTES` and `COMPUTE_STAGING_TTL_MS` do not
> exist. The compute-limits code has also moved out of `packages/selva/src/lib/server/computeLimits.ts`
> into the package, so the line references below point at the pre-extraction layout.

## Problem

The `/api/v1/compute` response is one JSON object built by SvelteKit's `json()`
([+server.ts:394](../../packages/selva/src/routes/api/v1/compute/+server.ts#L394)) and consumed by
`await res.json()` on the client
([+page.svelte:50](../../packages/selva/src/routes/library/[guid]/+page.svelte#L50)).

A `file` output is **not a separate channel**: it is just another leaf in
`GrasshopperComputeResponse.values: DataTree[]`, carrying the file as a base64 string
(`FileData.data`, `isBase64Encoded: true`). The `Trichter` hopper definition has exactly this
shape: an `Export .3dm file` output (`6283a395-…`) whose value is the full exported model.

### Why it hurts

Base64 inflates raw bytes by ~4/3, so a 250 MB model is ~333 MB of string. That string is then
duplicated at every hop:

**Server** ([+server.ts:374-394](../../packages/selva/src/routes/api/v1/compute/+server.ts#L374-L394)):

1. `scheduler.solve()` holds the parsed result object (the base64 string lives in `values`).
2. `json(result)` calls `JSON.stringify(result)`, making a **second** full copy as one contiguous
   string. V8 caps strings at ~512 MB (`0x1fffffe8`); a single ~333 MB base64 leaf plus the rest
   of the envelope can throw `RangeError: Invalid string length` _before_ any OOM. This is a hard
   wall, not a tuning knob: raising `BODY_SIZE_LIMIT` does nothing for it.

**Browser** ([+page.svelte:50-63](../../packages/selva/src/routes/library/[guid]/+page.svelte#L50-L63)):

3. `res.json()` buffers the whole body, then parses it → the parsed `solved` object.
4. `new GrasshopperResponseProcessor(solved)` retains a reference to it.
5. The per-output loop calls `getValueByParamId(o.id, { parseValues: true })` for **every**
   output, pulling the file-output's base64 into the `outputs` map, alive simultaneously with
   `solved`.
6. On download, `saveSingleFile` does `atob(file.data)` → a `Uint8Array` → a `Blob`
   ([file-download.ts:28-31](../../packages/ui/src/lib/utils/file-download.ts#L28-L31)), two more
   full-size copies.

Peak live memory in the tab is **4-5 concurrent copies** of a 250 MB payload: order ~1 GB for a
single solve. The tab is the real ceiling; it is hit long before any server cap.

### Scope boundary

- **In scope:** the cloud `/api/v1/compute` path (`@selvajs/selva`), which is where the 250 MB
  exports and the V8 stringify wall live.
- **Out of scope (for now):** local plugin mode (`@selvajs/plugin-ui` over WebSocket). It does not
  go through `json()`/`res.json()` and the user is on `localhost`. The same reference shape can
  later extend there, but it is not the binding constraint.
- **Unchanged:** small outputs (numbers, text, charts, dropdown values) stay inline. Meshes for
  the 3D viewer stay inline: they are already decoded to compact Three.js buffers and are bounded
  by viewer practicality, not file size.

## Decision

**A `file`-typed output never travels inside the solve JSON. It is staged server-side and
referenced.**

The solve response keeps everything it has today _except_ the base64 body of each `file` output,
which is replaced by a small descriptor:

```jsonc
// outputs[fileOutputId] becomes, instead of { file: "<base64>", … }:
{
	"kind": "file-ref",
	"fileName": "hopper",
	"fileType": ".3dm",
	"sizeBytes": 261947392,
	"url": "/api/v1/compute/files/{solveId}/{outputId}", // getPublicUrl()
	"expiresAt": "2026-06-03T13:10:00Z"
}
```

### Server flow (`POST /api/v1/compute`)

1. Solve as today.
2. **Partition outputs by size.** For each `file` output leaf whose decoded size exceeds
   `COMPUTE_INLINE_FILE_MAX_BYTES` (new knob, default ~1 MB; small files stay inline to avoid a
   round-trip), decode the base64 **once** to bytes and `storage.put()` it under a per-solve
   prefix: `compute-staging/{solveId}/{outputId}`. Replace that leaf in the response object with
   the `file-ref` descriptor **before** `json()` runs.
3. `json()` now serializes only descriptors + small/inline outputs + meshes: the 333 MB string is
   gone, so the V8 wall and the server-side double-copy both disappear.
4. **Response-size guard (defensive backstop).** After partitioning, if the serialized envelope
   still exceeds `COMPUTE_RESPONSE_MAX_BYTES` (new knob), fail with a clear `413`-style error
   instead of OOMing. This is the response-side analogue of `COMPUTE_REQUEST_MAX_BYTES`; today
   there is _no_ response cap at all.

### Staging storage + lifetime

- Reuse `IStorageProvider`
  ([interface.ts](../../packages/platform/src/storage/interface.ts)): `put`/`get`/`getPublicUrl`/
  `deletePrefix` already cover everything. No new provider method.
- Staged files are **ephemeral**: a short TTL (new knob `COMPUTE_STAGING_TTL_MS`, e.g. 10 min).
  Cleanup options, simplest first: (a) lazy sweep, on each solve, `deletePrefix` any staging
  prefix older than TTL; (b) delete-on-download. Recommend **both**: delete-on-download for the
  happy path, lazy-sweep as the GC for abandoned solves. No cron required.
- `solveId` is a fresh server-generated UUID per solve (not the cache key: a cached solve still
  mints a fresh staging URL so TTLs don't collide).

### New download endpoint `GET /api/v1/compute/files/{solveId}/{outputId}`

Modeled directly on the existing authenticated blob proxy
([files/[...path]/+server.ts](../../packages/selva/src/routes/api/files/[...path]/+server.ts)):

1. Path-shape gate: `solveId`/`outputId` must be valid UUIDs (anchored regex).
2. **Auth must match the solve's auth.** The original solve was gated by either a session
   (`requireCanSolve`/`requireCanEditDefinition`) or a share-link token. The download
   must re-run the _same_ gate against the _same_ definition. Cleanest: at stage time, record
   `{ definitionId, channel, projectId, shareLinkId? }` in a tiny sidecar
   (`compute-staging/{solveId}/manifest.json`) and have the download endpoint replay the gate.
   **A leaked staging URL must not be a generic open file proxy**: this is the exact M5 mistake
   the cover-image route's docstring warns against.
3. Stream the bytes back with `Content-Type` from `MIME_BY_EXT`
   ([file-download.ts:5-20](../../packages/ui/src/lib/utils/file-download.ts#L5-L20)) and
   `Content-Disposition: attachment`. Return `Buffer.from(bytes)` as the existing route does;
   a streaming `ReadableStream` from storage is a later optimization if 250 MB `Buffer`s pressure
   the server (they are one copy, not five, so acceptable initially).

### Client flow

- `onSolve` ([+page.svelte:16-71](../../packages/selva/src/routes/library/[guid]/+page.svelte#L16-L71))
  no longer finds base64 in `outputs[fileOutputId]`; it finds a `file-ref`. It stores the
  descriptor as the output value.
- `OutputDisplay`'s file branch
  ([OutputDisplay.svelte:303](../../packages/ui/src/lib/components/preview/OutputDisplay.svelte#L303))
  renders a Download button that, on click, navigates/fetches `descriptor.url`. The browser
  streams the file straight to disk: **no `atob`, no `Blob`, no full copy in JS memory.** This
  deletes the most expensive client-side copies outright.
- `saveSingleFile`/`getBase64FileSize` stay for the still-inline small-file path; the large-file
  path bypasses them.

## Compatibility with `@selvajs/compute` (sealed dist)

> At the time of writing, `@selvajs/compute` was consumed as a prebuilt external dist. It has since
> become a workspace package (`packages/compute`, 4.x), so "cannot edit it" is no longer the
> constraint, but the design below still holds, and no library change is needed to ship this ADR.

The processor (`GrasshopperResponseProcessor`) was a prebuilt dist (v1.5.2) not edited here.
The design avoids touching it:

- Partitioning happens in **our** route, on the parsed `GrasshopperComputeResponse`, _after_ the
  library returns it and _before_ `json()`. We mutate `values` (swap the base64 leaf for a
  descriptor) ourselves.
- The library's `extractMeshesFromResponse()` only reads geometry leaves, not `file` leaves, so
  removing a file leaf does not affect mesh extraction.
- `getValueByParamId` is called by **our** loop; we simply special-case `file`-typed outputs to
  pass through the descriptor instead of calling the library for them.

If a future `@selvajs/compute` release wants to own this partitioning, the descriptor shape above
is the contract to lift into it, but **no library change is required to ship this ADR.**

## New knobs (all in `computeLimits.ts`, env-overridable)

| Knob                            | Default | Purpose                                                            |
| ------------------------------- | ------- | ------------------------------------------------------------------ |
| `COMPUTE_INLINE_FILE_MAX_BYTES` | ~1 MB   | File outputs ≤ this stay inline (no round-trip).                   |
| `COMPUTE_RESPONSE_MAX_BYTES`    | ~25 MB  | Defensive cap on the serialized solve envelope after partitioning. |
| `COMPUTE_STAGING_TTL_MS`        | ~10 min | Lifetime of staged file blobs before lazy-sweep.                   |

`COMPUTE_REQUEST_MAX_BYTES` (request side) is unchanged by this ADR: see the file-input upload
fix that raised it to 210 MB.

## Consequences

**Positive**

- Eliminates the V8 `JSON.stringify` string-length wall on the server: the binding correctness
  bug, not just a perf issue.
- Cuts peak browser memory from ~5 copies to ~1 streamed-to-disk pass for the large output.
- Adds the missing response-size guard, closing the only un-capped payload direction.
- Reuses `IStorageProvider` and the existing authenticated-proxy pattern: no new infrastructure.

**Negative / risks**

- A second round-trip for large downloads (solve → click → fetch). Acceptable: the file is only
  needed on explicit download, not on every solve.
- Staging storage churn + a TTL/cleanup story to get right. Mitigated by delete-on-download +
  lazy-sweep; abandoned solves self-clean within one TTL.
- The download endpoint's auth replay is the security-critical seam. It MUST mirror the solve
  gate (session _or_ share-link), never degrade to "valid URL ⇒ file". Covered by the M5
  precedent.
- Share-link solves (anonymous, capped) need their staged downloads gated by the same link,
  handled by recording `shareLinkId` in the staging manifest.

## Implementation slices (tracer-bullet order)

1. **PR 1: descriptor type + partition + response guard, small files only.** Define the
   `file-ref` descriptor in `@selvajs/schemas`; partition in the route; add
   `COMPUTE_RESPONSE_MAX_BYTES`. Stage to storage but keep the threshold high so behavior is
   unchanged for existing payloads. Pure-logic partition function is unit-testable with a golden
   `GrasshopperComputeResponse` fixture (extends the cross-stack fixture pattern from ADR 0002).
2. **PR 2: download endpoint + auth replay + staging manifest.** Mirror the cover-image route;
   add the access-control test suite (session, share-link, leaked-URL-denied).
3. **PR 3: client (render descriptor, stream download, drop the inline path for large files).**
   E2E: solve a definition with a large file output, assert no base64 in the solve response and a
   working streamed download.
4. **PR 4: TTL cleanup (delete-on-download + lazy-sweep) and the low inline threshold flip.**

## References

- Request-side counterpart: the file-input upload fix (raised `COMPUTE_REQUEST_MAX_BYTES` to
  210 MB, added the client-side size guard in `FileInput.svelte`).
- Cross-stack fixture + extract-decision pattern: [ADR 0002](./0002-grasshopper-bridge-seam.md).
- Authenticated blob proxy precedent (M5 lesson):
  [files/[...path]/+server.ts](../../packages/selva/src/routes/api/files/[...path]/+server.ts).
