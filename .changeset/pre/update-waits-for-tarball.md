---
'@selvajs/selva': patch
---

The self-update waits, with the app still running, until npm serves the new release's files. npm lists a fresh version a few minutes before its tarball downloads, so an update started in that window stopped the app, failed the install with a 404 and rolled back. If the files are still missing after five minutes, it cancels without stopping the app.
