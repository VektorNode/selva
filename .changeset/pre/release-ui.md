---
'@selvajs/ui': major
---

A token-only design system, a reworked parameter panel and solve status, phone layouts, and host seams for the Rhino panel.

**Removed or changed (check before upgrading)**

- Tokens: `accent` / `accent-foreground` (use `hover` or `selected`), `sidebar-*`, `inputparam`, `outputparam` and `--radius` are gone, as are the alternate themes (`@selvajs/ui/styles/themes/*`, `ThemeSwitcher`, the theme store). Lint in `@selvajs/ui` rejects raw palette colours, arbitrary values and inline styles.
- Components: `Alert` (use `Callout`) and `Card.Action` are removed. `FilterableDropdown` items take `iconClass` only. `ActionButton` loses `size`, and `variant` is `'default' | 'destructive'`. `PageContent` renders a `<div>`, not a `<main>`; don't wrap `ComputeApp` or `AppLayout` in another `<main>`.
- `PresetLabels.saveButton` / `loadButton` become `saveMenuItem` / `loadMenuItem`, plus `saveConfirmButton`. The `expandPanel` / `collapsePanel` messages are gone.
- `AppLayout` takes a required `showViewer`. `ComputeApp` shows the viewer only for `viewerOptions.enableRemote`. `Viewer`'s `isSolving` is deprecated and ignored.
- `createSolvingIndicator` uses a fixed rule (hidden under 400 ms, shown at least 500 ms) and returns `slow`.

**Added**

- Surface roles (`raised`, `field`, `hover`, `selected`, `border-strong`, `faint-foreground`, shadows, `rounded-inner`) and utility tokens. Hanken Grotesk, self-hosted, as the UI typeface.
- shadcn `Popover`, `Command`, `DropdownMenu`, `ToggleGroup`, `Empty`, `Spinner`, `InputGroup`; new variants on `Card`, `Dialog`, `Tabs` (`line`), `Button` (`xs`) and `Resizable.Handle`. `SeverityIcon` and `IssueList` unify message icons.
- Parameter panel: borderless groups, responsive columns, one-box sliders, value-list `segmented` / `tiles` modes with icons and thumbnails, and a footer of Calculate plus one ⋯ menu holding presets and `panelActions` (`disabled`, `hint`, `solvesFirst`).
- Solve status grows with the solve in `AppLayout`'s action row (`live`, `onabort`, `progressShownByHost`). Esc aborts a solve in every host.
- Host seams: `freezesDuringSolve`, inline placements, one save and one pick function for files and downloads, `messages` overrides on `ComputeApp` (every visible string is in `ViewerMessages`, English and German), `onSolved(settlement)`, and `visibleInputItems`.
- Geometry inputs and buttons render only where they work (the Rhino panel).
- Viewer: one control dock with overflow, night mode, an in-viewer metadata card instead of a modal, and a fit button on touch. Phone drawer with half and full heights. `DataTableColumn.hideOnMobile`.
- Charts use Plotly.js 4.1.2 with SRI, Selva's palette and font, and play animated figures; Plotly's cloud "Share chart" is off.

**Fixed**

- Contrast: field borders, focus rings and error text reach WCAG thresholds in both modes. Accessibility: landmarks and headings, persistent live regions for solve progress, 44 px touch targets, named sliders and colour inputs.
- `AppShell` uses `dvh`, so iOS no longer hides the footer. Empty image and chart outputs stay hidden until data arrives. SVG outputs show on white. A WebP for an input that accepts PNG is sent as PNG. Closing a `Viewer` no longer loses its WebGL context twice.
- Accepts SvelteKit 2 or 3 as a peer.
