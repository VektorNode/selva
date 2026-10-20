---
'@selvajs/ui': minor
---

`ComputeApp` takes `messages?: Partial<ViewerMessages>`, layered over the `lang` catalog, so a host can reword any string of the app's chrome or supply every string for a language without a built-in catalog. The overrides reach every component inside, the viewer included. `setLocaleContext` takes the same overrides as an optional second getter, for a host that provides the locale at its root or uses `Viewer` on its own.

Every user-visible string the compute app renders now comes from `ViewerMessages`, with English and German entries: image, chart, file and text outputs, the file, number, text and dropdown inputs, the footer's message counts and copyright line, the message-centre dialog, the dialog close button, the theme toggle, the viewer's display looks and `ErrorScreen`. A `{name}` in a message is a placeholder the component fills in; pairs ending in `One`/`Other` are singular and plural.
