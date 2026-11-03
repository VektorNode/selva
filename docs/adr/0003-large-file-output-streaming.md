# ADR 0003: Large file outputs travel out-of-band, not inside the solve JSON

> **Status: PROPOSED, not implemented.** A `file`-typed Grasshopper output (e.g. an exported
> `.3dm`) is base64-embedded inside the `/api/v1/compute` JSON response. Real definitions produce
> 250+ MB exports. This ADR moves large file outputs out of the solve JSON: the response carries
> small geometry/meshes plus a **reference** to each file output, and the browser fetches the file
> as a separate binary stream on demand.
>
> Not built: the `file-ref` descriptor, the `compute-staging/` prefix and the
> `/api/v1/compute/files/…` route. `COMPUTE_INLINE_FILE_MAX_BYTES` and `COMPUTE_STAGING_TTL_MS` do
> not exist. Only `COMPUTE_RESPONSE_MAX_BYTES` landed, as a backstop on the un-partitioned payload.

## Problem

The `/api/v1/compute` response is one JSON object. The server serializes it in
`createResponseEncoder`
([response-encoding.ts](../../packages/solve/src/server/response-encoding.ts)); the client reads it
with `res.text()` and `JSON.parse`
([compute-fetch-solve-fn.ts](../../packages/solve/src/client/compute-fetch-solve-fn.ts)).

A `file` output is **not a separate channel**: it is another leaf in
`GrasshopperComputeResponse.values: DataTree[]`, carrying the file as a base64 string
(`FileData.data`, `isBase64Encoded: true`). The `Trichter` hopper definition has exactly this
shape: an `Export .3dm file` output (`6283a395-…`) whose value is the full exported model.

### Why it hurts

Base64 inflates raw bytes by ~4/3, so a 250 MB model is ~333 MB of string. That string is then
duplicated at every hop.

**Server**

1. The solve holds the parsed result object (the base64 string lives in `values`).
2. `JSON.stringify(result)` in `createResponseEncoder` makes a **second** full copy as one
   contiguous string. V8 caps strings at ~512 MB (`0x1fffffe8`), so a single ~333 MB base64 leaf
   plus the rest of the envelope can throw `RangeError: Invalid string length` before any OOM. The
   encoder catches it and answers 413, so it no longer crashes, but a large file output still
   cannot be returned. This is a hard wall, not a tuning knob: raising `BODY_SIZE_LIMIT` does
   nothing for it.

**Browser**

3. `res.text()` buffers the whole body and `JSON.parse` builds the `solved` object.
4. `GrasshopperResponseProcessor` retains `solved`.
5. The per-output loop calls `getValue({ byId }, { parseValues: true })` for **every** output,
   pulling the file output's base64 into the result outputs map, alive alongside `solved`.
6. On download, `saveSingleFile`
   ([file-download.ts](../../packages/ui/src/lib/utils/file-download.ts)) decodes the base64 to
   binary and wraps it in a `Blob`: two more full-size copies.

Estimated peak in the tab is 4-5 concurrent copies of a 250 MB payload, order ~1 GB per solve. The
tab is the real ceiling; it is hit long before any server cap.

### Scope boundary

- **In scope:** the cloud `/api/v1/compute` path (`@selvajs/selva`), where the 250 MB exports and
  the V8 stringify wall live.
- **Out of scope for now:** local plugin mode (`@selvajs/plugin-ui` over WebSocket). It does not go
  through the JSON response and the user is on `localhost`. The same reference shape can extend
  there later.
- **Unchanged:** small outputs (numbers, text, charts, dropdown values) stay inline. Meshes for the
  3D viewer stay inline: they are already decoded to compact Three.js buffers and are bounded by
  viewer practicality, not file size.

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
2. **Partition outputs by size**, in the server solve path (`@selvajs/solve/server`) before the
   response encoder runs. For each `file` output leaf whose decoded size exceeds
   `COMPUTE_INLINE_FILE_MAX_BYTES` (new knob, default ~1 MB; small files stay inline to avoid a
   round-trip), decode the base64 **once** to bytes and `storage.put()` it under a per-solve
   prefix: `compute-staging/{solveId}/{outputId}`. Replace that leaf with the `file-ref`
   descriptor.
3. The encoder now serializes only descriptors, small inline outputs and meshes. The 333 MB string
   is gone, so the V8 wall and the server-side double copy both disappear.
4. **Response-size guard (backstop).** `COMPUTE_RESPONSE_MAX_BYTES` already rejects an oversized
   envelope with a 413. Its 300 MB default fits the un-partitioned payload; once partitioning
   lands it should drop to fit descriptors plus meshes (the original proposal was ~25 MB).
   `COMPUTE_REQUEST_MAX_BYTES` (request side, 256 MB by default) is unchanged by this ADR.

### Staging storage + lifetime

- Reuse `IStorageProvider` ([interface.ts](../../packages/platform/src/storage/interface.ts)):
  `put`/`get`/`getPublicUrl`/`deletePrefix` cover everything. No new provider method.
- Staged files are **ephemeral**: a short TTL (new knob `COMPUTE_STAGING_TTL_MS`, ~10 min).
  Cleanup options, simplest first: (a) lazy sweep, on each solve `deletePrefix` any staging
  prefix older than the TTL; (b) delete-on-download. Do **both**: delete-on-download for the happy
  path, lazy sweep as the GC for abandoned solves. No cron required.
- `solveId` is a fresh server-generated UUID per solve, not the cache key: a cached solve still
  mints a fresh staging URL so TTLs don't collide.

### New download endpoint `GET /api/v1/compute/files/{solveId}/{outputId}`

Modeled directly on the existing authenticated blob proxy
([files/[...path]/+server.ts](../../packages/selva/src/routes/api/files/[...path]/+server.ts)):

1. Path-shape gate: `solveId`/`outputId` must be valid UUIDs (anchored regex).
2. **Auth must match the solve's auth.** The original solve was gated by either a session
   (`requireCanSolve`/`requireCanEditDefinition`) or a share-link token. The download must re-run
   the _same_ gate against the _same_ definition. Cleanest: at stage time, record
   `{ definitionId, channel, projectId, shareLinkId? }` in a tiny sidecar
   (`compute-staging/{solveId}/manifest.json`) and have the download endpoint replay the gate.
   **A leaked staging URL must not be a generic open file proxy**: this is the exact M5 mistake the
   cover-image route's docstring warns against.
3. Stream the bytes back with `Content-Type` from `MIME_BY_EXT` (`file-download.ts`) and
   `Content-Disposition: attachment`. Return `Buffer.from(bytes)` as the existing route does. A
   streaming `ReadableStream` from storage is a later optimization if 250 MB `Buffer`s pressure
   the server; it is one copy, not five, so acceptable initially.

### Client flow

- The compute-fetch solve function no longer finds base64 in a file output; it finds a `file-ref`
  and stores the descriptor as the output value.
- `OutputDisplay`'s file branch
  ([OutputDisplay.svelte](../../packages/ui/src/lib/components/preview/OutputDisplay.svelte))
  renders a Download button that navigates to or fetches `descriptor.url`. The browser streams the
  file straight to disk: **no base64 decode, no `Blob`, no full copy in JS memory.** This deletes
  the most expensive client-side copies outright.
- `saveSingleFile` and `getBase64FileSize` stay for the still-inline small-file path.

## Compatibility with `@selvajs/compute`

No library change is needed:

- Partitioning runs on the parsed `GrasshopperComputeResponse`, _after_ the library returns it and
  _before_ serialization. We swap the base64 leaf in `values` for a descriptor ourselves.
- Mesh decoding (`getThreeObjectsFromComputeResponse` in `@selvajs/visualization/parse`) reads only
  display leaves, not `file` leaves, so removing a file leaf does not affect it.
- The client's output loop reads each output with `GrasshopperResponseProcessor.getValue({ byId })`
  and special-cases `file`-typed outputs to pass the descriptor through.

If `@selvajs/compute` should own this partitioning later, the descriptor shape above is the
contract to lift into it.

## Consequences

**Positive**

- Removes the V8 `JSON.stringify` string-length wall on the server: the binding correctness bug,
  not just a perf issue.
- Cuts peak browser memory from ~5 copies to one streamed-to-disk pass for the large output.
- Reuses `IStorageProvider` and the existing authenticated-proxy pattern: no new infrastructure.

**Negative / risks**

- A second round-trip for large downloads (solve, click, fetch). Acceptable: the file is only
  needed on explicit download, not on every solve.
- Staging storage churn and a TTL/cleanup story to get right. Delete-on-download plus lazy sweep
  means abandoned solves self-clean within one TTL.
- The download endpoint's auth replay is the security-critical seam. It MUST mirror the solve gate
  (session _or_ share-link), never degrade to "valid URL means file".
- Share-link solves (anonymous, capped) need their staged downloads gated by the same link, so the
  staging manifest records `shareLinkId`.
