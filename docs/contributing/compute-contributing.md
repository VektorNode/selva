# Contributing to @selvajs/compute

Releases and changesets: [publishing.md](./publishing.md).

## Export rules

The barrels (`src/index.ts`, `src/core/index.ts`, `src/grasshopper/index.ts`) are the published
surface, so every line in them is a compatibility promise. Keep them readable:

- **Name every export.** No `export *`: a wildcard makes the public surface unreadable and
  re-exports whatever a submodule adds next.
- **Split types from values** with `export type`.
- **Put a new export in its group.** `grasshopper/index.ts` groups exports under section headers
  (a title between two lines of `=`); `core/index.ts` is short enough not to.
- **No wrapper `index.ts`** that re-exports a single module. Import
  `./compute-fetch/compute-fetch` directly.
- **Don't export a symbol just because it exists.** Add it when a consumer needs it.

The package has no root entry: one would promise Rhino and Grasshopper to every consumer.
Consumers import from `/core` or `/grasshopper`.

## Error handling

Throw `ComputeError` with a code from `ErrorCodes` and a `context` object, never a bare `Error`.
Callers branch on `err.code`, so pick the closest existing code before adding one.

## Feature dependencies

If a feature needs Selva plugin components or the VektorNode compute fork, say so in the docstring:

```typescript
/**
 * **Requires:** Selva Display component in Grasshopper + the VektorNode compute fork.
 */
```

## Adding an input param type

One raw IO parameter in, one typed `InputParam` out. All of it lives in
`src/grasshopper/io/input/`:

- `input-processors.ts` builds the shared `base` fields, canonicalizes the `paramType` casing, runs
  `normalizeDefault`, then looks up one parser. It has no per-type logic; keep it that way.
- `normalize-default.ts` flattens the raw `innerTree` default into a scalar, array or tree,
  depending on `treeAccess` / `atMost` and never on the type. Parsers get it already flattened.
- `input-type-parsers.ts` holds one `InputTypeParser` per type and the `INPUT_TYPE_PARSERS`
  registry. An unknown `paramType` goes to the Geometry parser.

Steps:

1. **Add the type** to `src/grasshopper/types/inputs.ts`: an interface extending `BaseInputType`
   with a literal `paramType`, and a member of the `InputParam` union. A new wire field also goes
   on `InputParamSchema` (`types/schema.ts`) and into `normalizeInputSchema`
   (`io/normalize-schema.ts`), which copies only the fields it names: a field missing there never
   reaches the parser.
2. **Write the parser** in `input-type-parsers.ts`. `parse(schema, base, warn?)` returns the typed
   param, and throws `ComputeError` on bad input it can't recover from. `warn` reports oddities
   it did recover from, on the same `parseErrors` channel. `fallback(schema, base)` is this type's
   safe param, used when `parse` throws. Copy the shape of `textParser`.
3. **Register it** in `INPUT_TYPE_PARSERS` under its canonical `paramType`. Lookup is
   case-insensitive, so `customtype` from a server finds `CustomType`.
4. **Export the type** from `src/grasshopper/index.ts`, in the `TYPES` block. A union member
   consumers can't name is a type they can't narrow to.
5. **Test** the parser through `INPUT_TYPE_PARSERS.get('CustomType')!.parse(schema, base)`, with
   `createInputSchema` from `tests/helpers/test-data-builders.ts`. Add a case to
   `process-inputs.characterization.test.ts` so the full pipeline, fallback included, is pinned.

A parser must:

- **Stay pure.** Read the schema, return a param, never mutate the schema.
- **Pass a tree default through.** When `treeAccess` or `atMost > 1` keeps the default as a
  `DataTreeDefault`, return it untouched (`isDataTreeDefault` from `data-tree/tree-path.ts`);
  `TreeBuilder` applies constraints later. Coercing it as a scalar drops it.
- **Expect missing fields.** `normalizeInputSchema` fixes the casing, but a server can omit any
  optional field.
