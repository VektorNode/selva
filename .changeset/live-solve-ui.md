---
'@selvajs/ui': minor
---

Add `SolveMessages`: one panel for what a solve reports. While solving it shows live diagnostics and progress with Abort; afterwards Discard/Continue for warnings, Dismiss for a blocked solve, and remarks that fade out.

Only a Selva Message component interrupts the user. Other Grasshopper messages go to the footer message centre; `AppShell`, `PageFooter` and `ComputeMessagesDialog` take a `diagnostics` prop so remarks are listed and counted. `ComputeApp` takes an `events` source for live events. `useSolveSession` exposes the new session state and disposes the session with its component.
