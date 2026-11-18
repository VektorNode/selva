---
'@selvajs/server': minor
'@selvajs/selva': patch
---

A definition page that opens before Rhino.Compute has read the file's saved values now says so. It keeps checking for about two minutes, then puts the values into every input the user has not changed and solves again. `createDefinitionLoader`'s result gains `defaultsPending`.

The Selva app built a new definition loader for every page load, so the loader forgot the saved values it had read, sent the file to Compute on each load, and never paused after a failed read. Forms then opened with stale or empty defaults whenever the stored schema lacked them. The app now keeps one loader.
