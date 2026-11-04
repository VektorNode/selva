---
'@selvajs/selva': patch
---

Restarts and updates no longer wait out PM2's full `kill_timeout`: open solve-event streams close on shutdown and browsers reconnect to the new process. Open tabs show a "Selva has been updated" notice with a Reload button once a new version is deployed.
