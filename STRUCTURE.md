# Project Structure

This document defines the conventions for where code lives and how it's named. The rules here are the contract every refactor and new file conforms to. If something in the codebase violates a rule, it's a bug — fix it or update this doc.

## Repository layout

```
selva/
├── Plugin/                         # .NET / Grasshopper plugin
│   ├── Selva.Schema/               # Schema models, validation, migration (no Rhino/GH deps)
│   ├── Selva.Drawing/              # Document-model drawing library + SVG/PDF renderers (no Rhino/GH deps)
│   ├── Selva.Drawing.Tests/        # xUnit tests for Selva.Drawing
│   ├── Selva.GH/                   # Grasshopper plugin (depends on Selva.Schema + Selva.Drawing)
│   ├── Selva.Tests/                # xUnit tests for Selva.GH + Selva.Schema
│   └── Releases/                   # Local build output only — NOT tracked; releases ship via plugin-release.yml (GitHub Releases + Yak registry)
│
├── packages/                       # TypeScript / Svelte workspace
│   ├── schemas/                    # ui-schema.json + TS/C# code generators
│   ├── platform/                   # Provider interfaces (auth, data, storage, ...)
│   ├── providers/
│   │   ├── local/                  # Filesystem implementation of platform (@selvajs/local-provider)
│   │   ├── supabase/               # Supabase implementation of platform (@selvajs/supabase-provider)
│   │   └── header-auth/            # Forward-auth provider, trusts reverse-proxy headers (@selvajs/header-auth-provider)
│   ├── ui/                         # Shared Svelte components, theme, primitives
│   ├── plugin-ui/                  # Grasshopper plugin UI — schema designer + preview, embedded into Selva.gha
│   ├── selva/                      # @selvajs/selva — the deployable Selva app (cloud mode)
│   └── config/                     # Shared ESLint/Vite/Prettier config
│
├── docs/                           # Project documentation
├── infra/                          # Terraform, deployment configs
├── scripts/                        # Build and setup scripts
└── .github/                        # Issue templates, workflows
```

## .NET / C# conventions

### Project boundaries

- **`Selva.Schema`** — `netstandard2.0`. No `using Rhino.*`, no `using Grasshopper.*`. Holds the generated schema, validation rules, migration logic, and shared constants. Anything reusable outside Grasshopper goes here.
- **`Selva.Drawing`** — `netstandard2.0`. No `using Rhino.*`, no `using Grasshopper.*`. Document model + SVG/PDF renderers used by the Drawing feature in `Selva.GH`.
- **`Selva.GH`** — `net48` + `net7.0` + `net9.0`. The `.gha` plugin. Rhino 8 ships both `net48` and `net7.0`; Rhino 9 ships `net9.0`. Rhino 7 is not supported. Depends on `Selva.Schema` and `Selva.Drawing`. All Grasshopper components, params, Goos, document/server lifecycle services live here.
- **`Selva.Tests`** — xUnit. Covers `Selva.GH` and `Selva.Schema`.
- **`Selva.Drawing.Tests`** — xUnit. Covers `Selva.Drawing`.

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

When a feature has both logic and UI:

- `lib/features/builder/` — pure TS: `operations.ts`, `widget-config.ts`, types, business logic.
- `lib/components/builder/` — Svelte: `BuilderSidebar.svelte`, `DraggableItem.svelte`, etc.

This separation is intentional. UI imports from logic, never the reverse.

### `utils/` is not a junk drawer

If a helper is specific to compute, schema, viewer, etc., it goes in a domain folder (`lib/compute/`, `lib/schema/`, `lib/viewer/`). `utils/` is reserved for _truly generic_ helpers (no domain assumptions).

### Routes (`selva/src/routes/<route>/`)

- `_components/` (underscore prefix — SvelteKit ignores these as routes) holds **route-private** components.
- Use `_components/` when the route owns **2 or more** page-specific components. Below that, just put them inline or import from `lib/components/`.
- Cross-route shared UI lives in `lib/components/` or `@selvajs/ui`.

## Cross-stack contracts (plugin ↔ UI)

The plugin (C#) produces data the UI (TS) consumes over WebSocket / Rhino.Compute. These are **two
implementations of one contract** — the recurring source of "works on one side, silently drops on the
other" bugs. Rules to keep them from drifting:

- **One source of truth per shape.** The schema is generated from `ui-schema.json` (CI fails on drift).
  For runtime wire shapes that aren't generated, give the payload a single Rhino-free type that both
  the local collector and the compute path serialize through (e.g. `DynamicValueListPayload`), so the
  two paths provably can't diverge. A `*ContractTests` test asserts local == compute.
- **One canonical location per concept.** A thing the UI reads must live in exactly one place. Outputs
  are canonical in `schema.Outputs`; layout items are routing sinks. `SchemaOutputCanonicalizer`
  enforces this in the validate funnel so every reader scans one place. Don't make readers tolerate
  "either/or" — repair the schema at the boundary instead.
- **Extract the decision out of the Rhino types.** Logic welded to `IGH_*` can't be unit-tested
  (Rhino breaks the test host). Pull the pure decision into a Rhino-free class linked into
  `Selva.Tests` (see `OutputPayloadBuilder`, `SchemaOutputCanonicalizer`); leave only the
  unwrap/IO in the Rhino-typed shell.

### Adding a new output type — checklist

Touch **both stacks and add a test on each side**, or it will silently half-work:

1. **Schema** — add the type to `ui-schema.json`, run `cd packages/schemas && pnpm run generate:all`.
2. **C# Goo** — a `*Goo : ISelvaSerializableGoo` whose wire shape lives in a Rhino-free payload type.
3. **C# collect** — a branch in `OutputPayloadBuilder` (the table-driven classifier) + a golden row in
   `OutputPayloadContractTests`. Do **not** add a new bespoke extractor in `ValueCollector`.
4. **C# canonicalize** — if it can live in the layout, mirror it into `schema.Outputs` in
   `SchemaOutputCanonicalizer` + an invariant test.
5. **TS route** — handle the new `outputs` payload in the UI consumer + a `vitest` covering it.
6. Run `dotnet test` **and** `pnpm test` — both must be green before the PR.

## Filename casing

| Context            | Convention                                                   | Example                                             |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| C# files           | `PascalCase.cs`, matches class name                          | `RhinoConverterOptions.cs`                          |
| TypeScript modules | `kebab-case.ts`                                              | `file-download.ts`, `visibility-rules.ts`           |
| Svelte components  | `PascalCase.svelte`                                          | `BuilderSidebar.svelte`                             |
| Reactive helpers   | `useThing.svelte.ts` (composables) or `kebab-case.svelte.ts` | `useFooterItem.svelte.ts`                           |
| Markdown docs      | `kebab-case.md`                                              | `quick-start.md`, `obsolete-components.md`          |
| Config templates   | `<name>.example.<ext>`                                       | `ecosystem.config.example.cjs`, `Caddyfile.example` |

**No `SCREAMING_SNAKE_CASE` filenames.** Documentation files are kebab-case.

## Documentation

- Top-level `README.md` is for users.
- `CLAUDE.md` is for AI agents working in the repo.
- `CONTRIBUTING.md` is for human contributors.
- `STRUCTURE.md` (this file) is the source of truth for layout/naming.
- Project-internal docs (developer notes, architecture deep-dives) go in `docs/`. Keep `examples/` for runnable artifacts only.
