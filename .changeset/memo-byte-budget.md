---
'@selvajs/solve': minor
'@selvajs/visualization': patch
---

The client's solve memo is capped by geometry bytes as well as by entries: 256 MB by default, `maxBytes` to change it. Every entry is a full copy of the scene's geometry, so a 13-million-triangle scene held about 390 MB per remembered solve, and a few solves could exhaust the tab. A result larger than the whole budget is not memoized and is fetched again instead. `MeshPolicy` gains an optional `byteSize`, which `meshPolicy` from `@selvajs/visualization/parse` implements.
