---
'@selvajs/visualization': minor
---

Move the mesh container to SLVM v3 and rework object identity to a single tracking key

The mesh payload is now an `SLVM` v3 chunked container — the same bytes on the wire, in `.gh`
archives, and on disk as `.slvm`. It replaces three nested layers: the `DMF1` file sidecar, the
JSON metadata embedded in the geometry blob, and a duplicate copy of that metadata the old file
carried (a 12,679-mesh scene shrinks from 3.05 MB to 1.33 MB on disk). The object table is
columnar and pays only for what's present: vertex/index windows are prefix sums, auto-numbered
names cost one byte total, and namespaced attr keys (`gh:branch`, `ifc:guid`, …) give hosts a
first-class slot for per-mesh provenance. Everything old still reads — `DMF1` files, bare
SLVA/SLVZ blobs in saved `.gh` files, every geometry blob back to v1 — but new bytes are always
SLVM v3, so decoding a fresh batch needs this release.

Object identity moved from `sourceComponentId` + `originalIndex` to a single minted
`userData.trackingKey`. The old pair couldn't tell two merges apart when both started at member
index 0, so hiding one hid the other; a merged mesh now carries one tracking key per member in
`userData.members`, and hidden state, selection, and per-object overrides all key on it directly.
`getStableKey`/`getTrackingKey` read the new field; callers that read `sourceComponentId` or
`originalIndex` off `userData` directly need to switch to `trackingKey`.
