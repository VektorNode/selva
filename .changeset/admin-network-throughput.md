---
'@selvajs/selva': patch
---

Add a network throughput test to /admin/system (instance admins). Upload and download tests transfer incompressible random data between the browser and the server through the full transport path (reverse proxy, SSO tunnels such as Azure App Proxy), measuring real transfer speed per direction — the ceiling any large solve payload is subject to. Backed by a new `/admin/api/system/throughput` endpoint (streamed download up to 64 MB, stream-counted upload up to 128 MB, memory-flat). Complements the env-flag-gated `/api/diag/throughput` curl probe with a UI that works behind SSO proxies where curl cannot authenticate. Also adds a response-whales log line naming the outputs that dominate large solve results.
