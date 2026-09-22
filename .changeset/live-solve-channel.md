---
'@selvajs/schemas': minor
'@selvajs/compute': minor
'@selvajs/solve': minor
'@selvajs/ui': minor
'@selvajs/selva': minor
'@selvajs/cli': minor
---

Live solve channel: a `SolveEvent` envelope carried over the plugin WebSocket locally and over
SSE from the Selva server in cloud mode, fed on Compute by a callback the plugin POSTs to
mid-solve. The callback reply carries an abort flag back into the running solve. Schema version
2.15.0 (codegen-only, nothing to migrate).

`@selvajs/ui`: `SolveMessages` replaces `SolveMessageDialog` — one bottom-centre panel for
everything a solve reports: live diagnostics with Abort while solving, then Discard/Continue for
warnings, Dismiss for a blocked solve, and remarks that linger and fade.

`@selvajs/solve`: a blocked solve is applied immediately as "no result" — outputs blanked, viewer
cleared — instead of being held behind an acknowledgement. `awaitingAck` is now only ever true
for a solve with warnings.

Only a Selva Message component interrupts the user now. Grasshopper's own warnings (a component
complaining about its own inputs) go to the footer message centre instead of opening a dialog on
every solve. `SolveResult` gains `diagnostics`, a structured list carrying each message's level,
source and `isGate`, populated on both transports — the WebSocket natively, Rhino.Compute by
parsing the flattened strings it returns. That parse also strips the `: component "X" (guid)`
suffix Compute appends, so users see the sentence the author wrote.

The Message component gains a `Notify` input — Popup or Log — so an author decides per message
whether it interrupts or only joins the message list. Errors ignore it and always interrupt,
since their result is withheld and an unexplained empty viewer is worse. `Level` and `Notify` are
named integer inputs: right-click either to pick "Warning" or "Log" by name.
