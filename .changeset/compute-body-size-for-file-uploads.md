---
'@selvajs/selva': minor
---

Raise the `/api/compute` request body cap to fit `file` widget uploads. A file input embeds its geometry as base64 inside `values`, inflating the raw bytes by ~4/3, so a worst-case body for the 150 MB client file cap is ~200 MB. `COMPUTE_REQUEST_MAX_BYTES` now defaults to 210 MB (was 5 MB), and the `BODY_SIZE_LIMIT` guidance in `.env.example` is updated to `210M` to stay above it. Both remain overridable via env.
