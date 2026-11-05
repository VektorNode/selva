---
'@selvajs/schemas': minor
---

Schema 2.19.0: host-aware inputs, value-list media, picked-object tracking and a night look.

- 2.16.0: `ParamType` gains `geometry`, `point`, `line` and `plane`; `CheckboxWidgetConfig` gains `displayAs: 'button'`. Only the Rhino panel picks geometry and presses buttons; Selva leaves them out and solves with the definition's own values. A plugin older than this release drops these elements on save: update the plugin on every machine that edits the file.
- 2.17.0: value lists gain `segmented` and `tiles` modes and an `optionMedia` map of icons and thumbnails, stored once in a root `assets` table. A schema with assets requires plugin 0.24.0.
- 2.18.0: `localOptions.trackPickedObjects` keeps picked geometry following its Rhino objects in the local preview.
- 2.19.0: `viewerOptions.look` sets the opening look, including the new `night` look.
- `MAX_TAGS` and `MAX_CATEGORY_LENGTH` export the limits Selva applies to `tags` and `category`. `enableLocal` / `enableRemote` document which host reads them.
- Wire: `SolveEndedPayload.slowest` lists a finished local solve's five slowest components (`SlowComponent`: `source`, `ms`).
