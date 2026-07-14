# Project Structure

This document defines the conventions for where code lives and how it's named. The rules here are the contract every refactor and new file conforms to. If something in the codebase violates a rule, it's a bug — fix it or update this doc.

## Repository layout

```
selva/
├── Plugin/                         # .NET / Grasshopper plugin
│   ├── Selva.Schema/               # Schema models, validation, migration (no Rhino/GH deps)
│   ├── Selva.Drawing/              # Document-model drawing library + SVG/PDF renderers (no Rhino/GH deps)
│   ├── Selva.Rhino/                # Rhino interop layer for Selva.Drawing (Rhino/GH deps, no Goos)
│   ├── Selva.GH/                   # Grasshopper plugin (depends on Selva.Schema + Selva.Drawing)
│   ├── Selva.Tests/                # xUnit tests for Selva.GH + Selva.Schema
│   ├── Selva.Drawing.Tests/        # xUnit tests for Selva.Drawing
│   └── Releases/                   # Local build output only — NOT tracked; releases ship via plugin-release.yml
│
├── packages/                       # TypeScript / Svelte workspace
│   ├── schemas/                    # ui-schema.json + TS/C# code generators
│   ├── compute/                    # @selvajs/compute — Rhino.Compute client, data-tree + Three.js helpers
│   ├── platform/                   # Provider interfaces (auth, data, storage, ...)
│   ├── providers/
│   │   ├── local/                  # Filesystem-backed provider (@selvajs/local-provider)
│   │   ├── supabase/               # Supabase provider (@selvajs/supabase-provider)
│   │   └── header-auth/            # Forward-auth provider (@selvajs/header-auth-provider)
│   ├── server/                     # @selvajs/server — transport-agnostic solve/compute server building blocks
│   ├── ui/                         # Shared Svelte components, theme, primitives
│   ├── plugin-ui/                  # Plugin UI — schema designer + preview, embedded into Selva.gha
│   ├── selva/                      # @selvajs/selva — deployable Selva app (cloud mode)
│   ├── website/                    # @selvajs/website — docs/marketing site
│   ├── cli/                        # @selvajs/cli — scaffold and operate a Selva deployment
│   └── config/                     # Shared ESLint/Vite/Prettier config
│
├── docs/                           # Project documentation
├── infra/                          # Terraform, deployment configs
├── scripts/                        # Build and setup scripts
└── .github/                        # Issue templates, workflows
```

## .NET / C# conventions

### Project boundaries

| Project               | Target            | Rhino/GH deps | Purpose                                                           |
| --------------------- | ----------------- | ------------- | ----------------------------------------------------------------- |
| `Selva.Schema`        | `netstandard2.0`  | none          | Generated schema, validation, migration, shared constants         |
| `Selva.Drawing`       | `netstandard2.0`  | none          | Document model + SVG/PDF renderers                                |
| `Selva.Rhino`         | `net48/net7/net9` | yes           | Rhino interop adapter for `Selva.Drawing`                         |
| `Selva.GH`            | `net48/net7/net9` | yes           | `.gha` plugin — all GH components, params, Goos, server lifecycle |
| `Selva.Tests`         | xUnit             | —             | Tests for `Selva.GH` + `Selva.Schema`                             |
| `Selva.Drawing.Tests` | xUnit             | —             | Tests for `Selva.Drawing`                                         |

Rhino 8 loads `net48` + `net7.0`; Rhino 9 loads `net9.0`. Rhino 7 is not supported.

### Naming rules

| Kind                     | Pattern                                      | Example                                             |
| ------------------------ | -------------------------------------------- | --------------------------------------------------- |
| `GH_Component` subclass  | `GH_PascalCase`                              | `GH_BlockToFile`, `GH_WebDisplay`                   |
| `IGH_Param` subclass     | `Param_PascalCase`                           | `Param_FileData`, `Param_ThreeMaterial`             |
| `IGH_Goo` type           | `XGoo` (PascalCase + `Goo` suffix)           | `FileDataGoo`, `WebDisplayGoo`                      |
| Service / helper / model | `PascalCase` (no prefix)                     | `SchemaManager`, `RhinoConverterOptions`            |
| Filename                 | **Must match the public class name exactly** | `GH_BlockToFile.cs` contains `class GH_BlockToFile` |
| Obsolete component       | `OBSOLETE_<ComponentName>_UntilV<X_Y_Z>`     | `OBSOLETE_WebDisplay_UntilV0_5_0.cs`                |
| Upgrader                 | `GH_<ComponentName>Upgrader`                 | `GH_WebDisplayUpgrader.cs`                          |

**No snake_case in C# class or filenames.** `GH_Block_To_File` should be `GH_BlockToFile`.

### Folder layout per Grasshopper feature

```
Selva.GH/Features/<FeatureName>/
├── Components/      # GH_Component subclasses
├── Params/          # Param_* subclasses (omit if none)
├── Goos/            # *Goo types (omit if none)
├── Services/        # Helpers / managers / converters used by the components
└── OBSOLETE/        # Deprecated components + their upgraders
```

Goos and Params live in their own folders, **not in `Components/` or `Services/`**.

### When does a folder earn its keep?

- A subfolder must contain **at least 3 files** at creation, OR
- Be a documented growth area (state the expectation in a `README.md` inside the folder).

One-file folders are a code smell. If `State/` has one file and the file moves to `Services/`, delete `State/`.

## TypeScript / Svelte conventions

### Per-package `src/lib/` shape

This is the shared vocabulary. Not every package uses every folder, but when a folder appears, it means the same thing everywhere:

| Folder              | What goes there                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/`       | Svelte components                                                                                              |
| `composables/`      | Reactive helpers (`.svelte.ts` files using runes)                                                              |
| `contexts/`         | Svelte context providers (typically `.svelte.ts`)                                                              |
| `features/<name>/`  | Pure TS logic for a feature (no Svelte) — operations, config, types                                            |
| `server/`           | Server-only code (SvelteKit `.server.ts` modules), only in apps                                                |
| `stores/`           | Global reactive state — only when not tied to a single feature                                                 |
| `theme/`, `styles/` | Design tokens, CSS, theme runtime                                                                              |
| `types/`            | Cross-cutting TS types (single-feature types live with the feature)                                            |
| `utils/`            | **Generic** helpers only (debounce, color, file-download). Categorical helpers live in feature/domain folders. |

### `features/` vs `components/`

`lib/features/<name>/` holds pure TS (operations, config, types); `lib/components/<name>/` holds the Svelte UI for the same feature. UI imports from logic, never the reverse.

### `utils/` is not a junk drawer

Domain-specific helpers go in their domain folder (`lib/compute/`, `lib/schema/`, etc.). `utils/` is for truly generic helpers with no domain assumptions (debounce, color, file-download).

### Routes (`selva/src/routes/<route>/`)

- `_components/` (underscore prefix — SvelteKit ignores these as routes) holds **route-private** components.
- Use `_components/` when the route owns **2 or more** page-specific components. Below that, just put them inline or import from `lib/components/`.
- Cross-route shared UI lives in `lib/components/` or `@selvajs/ui`.

## Cross-stack contracts (plugin ↔ UI)

The plugin (C#) and UI (TS) are two implementations of one contract over WebSocket / Rhino.Compute. Rules to prevent drift:

- **One source of truth per shape.** `ui-schema.json` generates both stacks (CI fails on drift). For non-generated wire shapes, use a single Rhino-free payload type shared by both paths; a `*ContractTests` test asserts they match.
- **One canonical location per concept.** Outputs live in `schema.Outputs`, canonicalized by `SchemaOutputCanonicalizer` at the boundary. Readers never tolerate "either/or".
- **Keep decisions out of Rhino types.** Pull pure logic into Rhino-free classes in `Selva.Tests` (see `OutputPayloadBuilder`, `SchemaOutputCanonicalizer`); leave only unwrap/IO in GH-typed shells.

### Adding a new output type

1. **Schema** — add to `ui-schema.json`, run `cd packages/schemas && pnpm run generate:all`.
2. **C# Goo** — `*Goo : ISelvaSerializableGoo` with a Rhino-free payload type for the wire shape.
3. **C# collect** — branch in `OutputPayloadBuilder` + golden row in `OutputPayloadContractTests`. Don't add a new extractor in `ValueCollector`.
4. **C# canonicalize** — if it can appear in layout, mirror into `schema.Outputs` in `SchemaOutputCanonicalizer` + invariant test.
5. **TS** — handle the new payload in the UI consumer + a vitest.
6. `dotnet test` and `pnpm test` must both be green.

## Filename casing

| Context            | Convention                                                   | Example                                    |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| C# files           | `PascalCase.cs`, matches class name                          | `RhinoConverterOptions.cs`                 |
| TypeScript modules | `kebab-case.ts`                                              | `file-download.ts`, `visibility-rules.ts`  |
| Svelte components  | `PascalCase.svelte`                                          | `BuilderSidebar.svelte`                    |
| Reactive helpers   | `useThing.svelte.ts` (composables) or `kebab-case.svelte.ts` | `useFooterItem.svelte.ts`                  |
| Markdown docs      | `kebab-case.md`                                              | `quick-start.md`, `obsolete-components.md` |
| Config templates   | `<name>.example.<ext>`                                       | `Caddyfile.example`                        |

**No `SCREAMING_SNAKE_CASE` filenames.** Documentation files are kebab-case.

## Documentation

- Top-level `README.md` is for users.
- `CLAUDE.md` is for AI agents working in the repo.
- `CONTRIBUTING.md` is for human contributors.
- `STRUCTURE.md` (this file) is the source of truth for layout/naming.
- Project-internal docs (developer notes, architecture deep-dives) go in `docs/`. Keep `examples/` for runnable artifacts only.
