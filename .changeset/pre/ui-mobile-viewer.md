---
'@selvajs/ui': minor
---

Phone and touch fixes for the viewer and the app shell:

- Tapping a mesh with metadata opens a card inside the viewer instead of a modal dialog. The modal locked the page, and on touch a quick tap outside often failed to close it, leaving the viewer frozen. The card closes on a background tap, on selecting an object without metadata, or when a new solve arrives; its close button also clears the selection highlight.
- On touch devices a fit-to-view button sits next to the viewer's tools button. The tools button and logo no longer sit higher on phones to clear the drawer handle.
- The phone parameter drawer has a half and a full height. At half height the viewer resizes to the space above it, un-blurred, so the model stays visible while inputs change. Tap the handle to step closed → half → full → closed, or swipe it. The handle reads "Parameters" when there are several tabs.
- `AppShell` uses `dvh` instead of `100vh`, so iOS no longer hides the footer and drawer handle behind its toolbar. `--page-px` is 1rem below 640px.
- `PageHeader` truncates the title and hides the brand name next to a title on phones. `SideNav` becomes a scrolling strip above the content below 640px. `SectionHeader` stacks its actions under the title.
- Dialogs keep a 1rem gutter even when the caller passes a `max-w-*`, alert dialogs scroll when taller than the screen, and `Drawer` is capped at the screen width.
- The output copy button and chart toolbar, hover-only before, are always visible on touch devices.
- Native `<select>` elements get a drawn chevron with its own right gutter. The browser's arrow sat on the border at the `px-2`/`px-3` padding every caller uses.
- `DataTableColumn` takes `hideOnMobile` to drop a column below 640px, and a column without a `width` is `minmax(0, 1fr)` so long values truncate instead of widening their row.
