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
mid-solve. The callback reply carries an abort flag back into the running solve.

`@selvajs/schemas`: message and runtime types (`SolveEvent`, the discovery models, session state)
move from `ui-schema.json` into a new `wire-schema.json`. Type names and the package's exports are
unchanged. The schema version stays 2.14.0: only definitions a saved UI schema can reach are
versioned now. `wire-schema.json` adds `SolveDiagnostic`, `SolveOutcome` and a payload type per event
kind; `SOLVE_EVENT_KINDS` gives each kind its delivery class (`critical`, `latest`, `bestEffort`).

The plugin now decides each solve's verdict once (`SolveOutcome`: diagnostics, blocked, aborted)
and both transports carry it: the local `outputs` envelope as `outcome`, and Rhino.Compute as a
`selva` block when the VektorNode fork is used. A blocked or aborted Compute solve returns no
values. Without the block the client falls back to the message markers, as before. Locally the
plugin also emits `solveStarted`/`solveEnded`, so both paths send the same event sequence, and
it can report `progress`.

`@selvajs/solve`: the session exposes `live` (a `LiveSolveState`: diagnostics, progress per
source, how the solve ended) instead of `liveEvents`, a `phase` (`idle`, `solving`,
`review`, `blocked`), and `dispose()`. `SolveResult` gains `aborted`. `decodeOutcome` and
`finalizeResult` are the one decoder both drivers use. The cloud event stream connects as soon
as it is created.

`@selvajs/ui`: `SolveMessages` replaces `SolveMessageDialog` — one bottom-centre panel for
everything a solve reports: live diagnostics and progress with Abort while solving, then Discard/Continue for
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
