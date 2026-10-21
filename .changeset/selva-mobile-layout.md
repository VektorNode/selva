---
'@selvajs/selva': patch
---

Phone layout fixes:

- The main nav is icon-only below 640px, and the version/draft preview badge drops the word "preview", so the header's settings, logout and theme buttons fit.
- `/projects` swaps its project sidebar for a project picker on phones, wraps its header actions and search bar, and drops the project, updated and runs columns from the list view, which kept the row's open button off-screen.
- The library list drops tags and run count on phones. The star, "Open" and "Resume" affordances, hover-only before, are visible on touch devices.
- The login, setup, invite, OAuth and email-sent pages centre against `dvh` instead of `100vh`.
