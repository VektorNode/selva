---
'@selvajs/visualization': patch
---

Edge overlays build up to 18x faster on dense meshes and now cover meshes up to 8M triangles (was 4M). Dense meshes parse about 2x faster when the plugin sends its closed-solid verdict (new optional `CLSD` container chunk; older containers are computed as before). Clearing a scene of 100k meshes no longer takes seconds, merging 100k+ meshes of one material no longer overflows the stack, and box-like parts carry 40% fewer vertices after crease splitting.
