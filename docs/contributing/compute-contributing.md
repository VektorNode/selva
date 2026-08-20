# Contributing to @selvajs/compute

## Commits & Changesets

- **Commit messages:** Use conventional format (`chore:`, `feat:`, `fix:`, `docs:`)
- **Changesets:** Create one per significant change in `.changeset/` directory

  ```markdown
  ---
  '@selvajs/compute': patch
  ---

  Brief description of changes
  ```

## Export rules

The barrels (`src/index.ts`, `src/core/index.ts`, `src/grasshopper/index.ts`) are the published
surface, so every line in them is a compatibility promise. Keep them readable:

- **Name every export.** No `export *` — a wildcard makes the public surface unreadable and
  re-exports whatever a submodule adds next.
- **Split types from values** with `export type`.
- **Group with section headers** (a title between two lines of `=`), matching the existing barrels.
- **No wrapper `index.ts`** that re-exports a single module. Import
  `./compute-fetch/compute-fetch` directly.
- **Don't export a symbol just because it exists.** Add it when a consumer needs it.

`src/index.ts` is deliberately empty — the root would promise Rhino and Grasshopper to every
consumer. Import from `/core` or `/grasshopper`.

## Error handling

Throw `ComputeError` with a code from `ErrorCodes` — never `undefined`. Two static helpers cover
the recurring input cases:

```typescript
throw ComputeError.missingValues('inputName', 'Type');
throw ComputeError.unknownParamType(paramType, paramName);
```

Everything else constructs directly with an explicit code and context.

## Feature dependencies

If a feature needs Selva plugin components or the VektorNode compute fork, say so in the docstring:

```typescript
/**
 * **Requires:** Selva Display component in Grasshopper + the VektorNode compute fork.
 */
```
