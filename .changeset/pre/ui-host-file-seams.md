---
'@selvajs/ui': minor
---

File inputs, preset import and every download (output files, archives, presets, viewer screenshots) now go through one save function and one pick function. In a browser nothing changes, except that picking the same file twice in a row now works. A host whose WebView can't download or show a file picker can install its own native dialogs.
