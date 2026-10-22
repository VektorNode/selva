---
'@selvajs/compute': patch
'@selvajs/ui': patch
---

Internal cleanup of `@selvajs/compute` with no API change. Two things are visible:

- Transport errors share one `context` shape (`serverUrl`, `url`, `endpoint`, `requestId`, `requestSize`, plus `timeoutMs` on a timeout), so some errors carry more keys than before. Input parse messages name an unnamed input `"unknown"`.
- `@selvajs/ui`'s file download decodes base64 with `decodeBase64ToBinary`, so invalid base64 throws a `ComputeError` with code `ENCODING_ERROR` instead of a `DOMException`.
