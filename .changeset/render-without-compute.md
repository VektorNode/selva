---
'@selvajs/server': minor
'@selvajs/selva': patch
---

A definition page no longer waits on Rhino.Compute when its version has a stored schema. The loader serves the stored schema at once and reads the file's saved input values (`/io`) behind it, so a large definition no longer holds the page past a reverse proxy's timeout (504). Concurrent loads share one read, and a failed read waits a minute before the next.

A version with no renderable stored schema waits at most `renderWaitMs` (default 20 s), then fails as `connect` (503) while the read finishes for the retry.

Uploads store the file's saved values as input defaults (`extractSchemaForUpload` in `@selvajs/server/definitions`). A version uploaded before this release shows the defaults from its last schema sync on its first render, until the background read lands.
