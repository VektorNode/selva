# Contributing to Selva

## Getting started

```bash
pnpm install
pnpm dev:plugin            # Terminal 1: plugin UI at http://localhost:5173
cd Plugin && dotnet build  # Terminal 2: plugin dev
```

`pnpm dev:selva` runs the standalone Selva app instead. The plugin opens the dev-server URL with its
own `wsPort` in the query string and the page connects back over WebSocket, so web changes hot-reload
while the plugin stays debuggable.

Requirements, commands, and environment variables are in the
[Quick Start](./docs/self-hosting/get-started/quick-start.md).

## Project structure

[STRUCTURE.md](./STRUCTURE.md) is the source of truth for where code lives and how it's named — folder layout, C# naming rules, TypeScript package conventions. Read it before adding new files or moving things around.

## Code style

- Clear code beats clever code. Use descriptive names instead of comments for obvious logic.
- Comment only non-obvious decisions and warnings.
- Extract magic values to named constants.
- TypeScript: prefer `undefined` over `any`; keep functions focused and composable.
- C#: explicit block syntax — `if (x) return y;` on one line is out.

### Schema changes

Never edit generated files. Change `packages/schemas/ui-schema.json`, then run `pnpm generate` at the repo root. That regenerates `packages/schemas/src/generated/schema.ts` and `Plugin/Selva.Schema/Models/UISchema.Generated.cs`.

### Changing a released component's params

Adding or removing a param on a released Grasshopper component silently rewires saved definitions. Follow the OBSOLETE + upgrader procedure in [STRUCTURE.md](./STRUCTURE.md#changing-a-components-parameters-obsolete--upgrader). CI enforces it.

## Before you submit

```bash
pnpm format
pnpm lint:fix
pnpm type-check
pnpm test
```

If C# changed, also `cd Plugin && dotnet build && dotnet test`.

## Testing plugin changes

```bash
cd Plugin && dotnet build
pnpm run build:plugin      # .gha with embedded web assets
```

Copy the result to your Grasshopper libraries folder, then restart Rhino completely:

```bash
# Windows (Rhino 8)
copy "Plugin\bin\Release\net7.0\Selva.gha" "%APPDATA%\Grasshopper\Libraries-8\"

# macOS (Rhino 8)
cp Plugin/bin/Release/net7.0/Selva.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

Write tests that cover workflows and integration, not trivial cases. [docs/contributing/testing.md](./docs/contributing/testing.md) covers where tests live and the shared vitest config.

## Branch naming

`feature/`, `fix/`, `docs/` + a short description.

## Issues & PRs

Keep descriptions concise — what needs solving and why. Reference related issues. Aim for small, focused changes.
