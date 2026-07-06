---
'@selvajs/selva': patch
---

Stop re-uploading solve outputs in the solve request. The solve session merges result outputs (e.g. dynamic value list option payloads, which can be several MB) back into the same values map that inputs live in; the library runner previously snapshotted that whole map into the POST body on every solve. The server only ever reads input-keyed values, so the output entries were dead weight — a measured 6.4 MB per solve on a definition with a large computed value list. The runner now sends only values keyed by schema input ids, shrinking such requests from megabytes back to kilobytes.
