---
'@selvajs/schemas': minor
---

Add `wire-schema.json` (also exported as `@selvajs/schemas/wire-schema.json`) for messages and runtime state, which are never saved into a .gh. Discovery models and session state move there from `ui-schema.json`; type names and exports are unchanged, and the schema version stays 2.14.0.

New types: `SolveEvent` (the live-solve envelope), a payload type per event kind, `SolveDiagnostic` and `SolveOutcome`. `SOLVE_EVENT_KINDS` gives each kind its delivery class (`critical`, `latest`, `bestEffort`).
