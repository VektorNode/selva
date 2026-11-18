---
'@selvajs/server': minor
'@selvajs/selva': patch
---

Uploading a large definition no longer lists every input as `default X → none`. An upload waited 5 seconds for Compute to read the file's saved values, and a large file takes longer. It now waits up to 45 seconds, and the check and the upload that follows share one read, so a file too slow for the check is read by the time it is uploaded.

When the values still are not read, the changes leave defaults out and the dialog says so. `extractSchemaForUpload` and the check and upload responses gain `defaultsPending`.
