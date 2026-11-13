---
'@selvajs/selva': patch
---

The in-app update no longer dies halfway under pm2 7, and the app stops when asked. Two faults, both found by running a real update on a Linux host:

- The update runner called `pm2 stop` while still a child of the app. pm2 7 lists the app's descendants at that moment and SIGKILLs whatever outlives its kill timeout, so the runner was killed after stopping the app and before installing anything: the app stayed down on the old version until someone ran `selva update` by hand. It only showed when the registry answered within a second. The runner is now orphaned before it runs a line.
- The app never exited on SIGINT or SIGTERM. adapter-node closes the HTTP server and waits for the event loop to empty, which timers kept from happening, so every stop, restart and update waited out pm2's 10 second kill timeout and ended in SIGKILL, losing the solve-metric sink's last batch. The app now flushes and exits once the server has closed: a stop takes about a second.
