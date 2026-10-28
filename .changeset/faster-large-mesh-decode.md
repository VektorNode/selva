---
'@selvajs/visualization': patch
---

Large meshes decode faster and no longer freeze the page while they unpack. For a 2.7M-triangle frame, decoding takes about 20% less time and the time the page is blocked per solve drops from about 70 ms to under 2 ms, because the geometry is now decompressed in a worker instead of on the main thread. The decoder also copies roughly 40 MB less per solve.
