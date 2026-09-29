Verdict fixtures shared by both test stacks.

- `event-kinds.json`: delivery class per live event kind. `SolveEventKindsTests` (C#) and
  `solve-event-kinds.test.ts` compare their tables against it.
- `outcome.json`: a `SolveOutcome` as the plugin serializes it. Written by
  `SolveOutcomeContractTests` (`UPDATE_WIRE_FIXTURES=1`).
- `compute-response-selva.json`: the same solve as the VektorNode fork returns it, with the
  `selva` block.
- `compute-response-legacy.json`: the same solve with markers only, as a stock server or an
  older plugin returns it. Hand-written from observed Compute output.

`packages/solve/src/shared/__tests__/outcome.test.ts` decodes all three and requires the same
verdict, except what the legacy path cannot carry: remarks and `aborted`.
