---
'@selvajs/compute': patch
---

Request bodies of 1 KB or more are gzipped for a server whose last response advertised `Accept-Encoding: gzip`, as Rhino.Compute does since `RHINO_COMPUTE_COMPRESSION`. Other servers get plain JSON as before. A non-500 JSON error body is read for its `message`, so a Compute 400 reads `Bad request: Bad Request — <message>` rather than quoting the raw JSON.
