---
'@selvajs/selva': patch
---

Fix truncated `/api/compute` responses surfacing as `Unterminated string in JSON` in the browser. Solve responses are now gzipped in one buffered pass and sent with an explicit `Content-Length` (instead of a streamed `CompressionStream` body with no length), so a connection cut mid-transfer — e.g. a proxy/tunnel timeout on a multi-minute large download — fails as a hard network error the client can detect and retry, rather than resolving with a partial body that `JSON.parse` rejects. Buffered compression costs only a few hundred ms on a ~40 MB payload, negligible next to the transfer time it protects.
