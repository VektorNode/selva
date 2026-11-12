---
'@selvajs/ui': minor
---

Form lists that depend on other inputs, one solve per change. A `dynamicValueList` payload can carry rows (`rows`, `members`): `TabLayout` draws the member inputs once per row, and a repeated input's value is one JSON object of row key to pick, so a pick stays with its row when the rows change.

A payload with `resolvedInSolve` comes from an output wired into its Get Dynamic Value List, which resolves the pick in the same solve. The form shows that resolved pick (still offered: kept, otherwise the first option) and never sends a correction; the user's own pick stays in the values and comes back when it is offered again. Payloads without it keep the control's reconciler.

New exports: `buildFormModel`, `FormModel`, `RepeatSpec`, `RepeatRow`, `resolvePick`, `resolvePicks`, `keepHiddenPicks`, `readRowPicks` and `withRowPick`. `DynamicValueListPayload` gains `rows`, `members` and `resolvedInSolve`. Needs a Selva plugin with Repeat; older plugins send none of these fields and behave as before.
