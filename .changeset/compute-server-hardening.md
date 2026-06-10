---
'@selvajs/selva': minor
---

Harden and extend the compute server. SSRF protection on compute requests is
substantially stronger: URL validation now rejects a wider range of internal,
loopback, and metadata-endpoint targets before any outbound fetch. Compute
request/response limits were updated, the `/api/compute` route was simplified,
and file-import now accepts URLs with improved error handling. The
WebSocket solve driver gained richer logging and dynamic asset loading, and
display handling supports non-mesh display items and preview geometry.
