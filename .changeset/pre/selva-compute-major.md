---
'@selvajs/selva': minor
---

Built against `@selvajs/compute` 5 and `@selvajs/solve` 2. What changes for a running instance:

- What a solve sends to Grasshopper:
  - `generic` inputs reach Grasshopper; they were dropped.
  - A number or boolean value that can't be coerced is left out, so Grasshopper keeps its own value. It used to send `0`, the minimum, or `false`.
  - Text, color and file values are sent as entered.
- The `selva_cache`, `def_reupload` and `rhino_*` Server-Timing entries stay correct when solves overlap; they used to be dropped. A definition's first solve reports `def_reupload` as an upload, not a server cache hit.
- Hashing a definition for a solve is about 2.8× faster.
