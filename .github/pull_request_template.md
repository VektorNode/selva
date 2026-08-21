## What and why

<!-- What changes, and what problem it solves. Link the issue: "Closes #123". -->

## How to verify

<!-- The steps a reviewer takes to see it work. For a plugin change, say which
     Rhino version you tested on — CI cannot run Rhino. -->

## Checklist

- [ ] `pnpm type-check && pnpm lint && pnpm test` passes
- [ ] `cd Plugin && dotnet build` passes (if C# changed)
- [ ] `pnpm generate` re-run and generated files committed (if `ui-schema.json` changed)
- [ ] Changeset added for any published `@selvajs/*` package (`pnpm changeset`) — CI enforces this
- [ ] Docs updated if behaviour, config, or a public API changed

### If this touches a released Grasshopper component

Grasshopper binds wires by index, so changing a param list on a released component
silently rewires saved definitions.

- [ ] Params unchanged, **or** the OBSOLETE + upgrader procedure in
      [STRUCTURE.md](../STRUCTURE.md#changing-a-components-parameters-obsolete--upgrader)
      was followed
