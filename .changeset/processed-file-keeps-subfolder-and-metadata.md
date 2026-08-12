---
'@selvajs/compute': minor
---

`ProcessedFile` keeps the GH-owned `subFolder` and `metadata` that `FileData` carried.

`extractFilesFromComputeResponse` normalizes each `FileData` into a `ProcessedFile` shaped for an
archive: `subFolder` is fused into `path`, and `metadata` was dropped entirely. That is right for
the ZIP path — `downloadFileData` only needs a path per entry — but it loses data for the other
public entry point, whose whole purpose is handing files to a caller that stores them itself.

A consumer that persists files per output slot needs both fields back. Recovering them meant
pairing the returned `ProcessedFile[]` against the raw `FileData[]` **by index**, which reads as a
coincidence rather than a contract and is ambiguous the moment `processFiles` renames a duplicate
path (`out/model.txt` → `out/model-2.txt`): the rename is exactly when a caller would re-split
`path` to recover the folder, and exactly when that re-split is wrong.

Both fields are now carried through:

- **`subFolder`** — the sanitized folder, separately from `path`. `''` means archive root. It is the
  same value that went into `path`, so zip-slip sanitization applies to both (`../../etc` reports
  `etc`, matching the path).
- **`metadata`** — the Grasshopper-authored map, verbatim. Read case-insensitively via `readField`
  like every other wire field, so PascalCase (mcneel branch) and camelCase (VektorNode fork)
  payloads both decode. Inner keys are author-controlled and are never rewritten.

Both are optional on the type, so hand-built `ProcessedFile`s still typecheck. `metadata` is omitted
rather than set to `undefined` when the source item had none, and files fetched from a
`FileBaseInfo` URL get `subFolder` but never `metadata` — an external URL carries no GH authoring
context.

Additive: existing consumers read `fileName`/`content`/`path` and are unaffected.
