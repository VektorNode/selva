---
'@selvajs/compute': minor
---

`downloadFileData` and `downloadFileDataByRoot` take an optional `{ saveBlob }` as their last argument. When it's given, each finished archive goes to it instead of an `<a download>` click. Use it in an embedded WebView where anchor downloads don't work. Calls without it behave as before.
