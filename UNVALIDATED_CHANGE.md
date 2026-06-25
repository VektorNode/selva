# ⚠️ Unvalidated change — needs your review

**Status:** NOT yet validated against a real solve. Tests pass; behavior in Grasshopper not confirmed.

## What changed

`packages/selva/src/routes/api/compute/+server.ts` — replaced the hand-rolled
`transformInputParameter` with the package's `processInput` (same as the parapet app
already does). Plus new tests: `packages/selva/src/routes/api/compute/__tests__/transform-input.test.ts`.

## Why

The old code only handled `number`/`integer`/`text`/`boolean`. Everything else
(`valueList`, `file`, `color`, `generic`) silently fell through to `Text`. The Deckstreifen
schema has two `valueList` dropdowns on that broken path.

## Behavior changes to validate

1. **valueList / file / color / generic** now get correct paramType
   (ValueList / File / Color / Geometry) instead of Text. → **Verify the dropdowns + any
   file/color inputs still solve correctly.**
2. **Absent value + absent default** → input is now OMITTED from the solve (GH uses its own
   internal default) instead of being forced to `''` / `false`. → **Verify no input that
   relied on the old forced-empty default now misbehaves.**
3. **number stepSize** is recomputed by the package from the value's precision, ignoring the
   schema's configured stepSize. Server-side clamping only; does not change the value sent.
4. **generic** maps to `Geometry` (package fallback), not Text.

## Not done

- Not committed (clean branch).
- Booleans were never broken — `false` survives end-to-end, confirmed. This change does NOT
  address the "End-Ende Erstellen" issue, which is downstream Grasshopper wiring.

## To run the tests

```
cd packages/selva && pnpm vitest run src/routes/api/compute/__tests__/transform-input.test.ts
```
