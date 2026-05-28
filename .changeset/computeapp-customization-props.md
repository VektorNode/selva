---
'@selvajs/ui': minor
---

Expose customization hooks on `ComputeApp` for embedding the parameter app in external sites.

- **Pluggable preset persistence**: new optional `onSaveState` / `onListStates` props on `ComputeApp` (threaded through `AppLayout` → `ParameterPresetManager`). When `onSaveState` is set, saving a parameter state calls it instead of downloading a `.sps` file; when `onListStates` is set, the Load dialog lists the returned presets (each routed through the existing validation flow) instead of showing a file input. Both fall back to the file-based behavior when unset, so existing apps are unchanged.
- **Localizable preset UI**: new optional `presetLabels` prop accepts a `Partial<PresetLabels>` overriding every string in the Save/Load/validation dialogs. `PresetLabels` and `DEFAULT_PRESET_LABELS` are exported from the package root.
- **Footer text**: new `copyrightName` and `footerText` props. `footerText` fully overrides the footer line with `{name}` / `{year}` substitution; otherwise the default `by {name} © {year}` is used.
- **Bring-your-own header**: new `header` snippet on `ComputeApp` (and `AppShell`). When provided, it renders inside the standard sticky header bar at the fixed `--header-h` height — so the fixed-mode layout is unaffected — and takes precedence over `headerRight`.
