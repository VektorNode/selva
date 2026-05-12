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
│   └── Releases/                   # Versioned .yak/.gha release artifacts (tracked)
│
├── packages/                       # TypeScript / Svelte workspace
│   ├── schemas/                    # ui-schema.json + TS/C# code generators
│   ├── platform/                   # Provider interfaces (auth, data, storage, ...)
│   ├── local-provider/             # Filesystem implementation of platform
│   ├── supabase-provider/          # Supabase implementation of platform
│   ├── header-auth-provider/       # Forward-auth provider (trusts reverse-proxy headers)
│   ├── ui/                         # Shared Svelte components, theme, primitives
│   ├── builder-app/                # Schema designer (local dev mode)
│   ├── compute-app/                # Standalone compute app (cloud mode)
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

### Routes (`compute-app/src/routes/<route>/`)

- `_components/` (underscore prefix — SvelteKit ignores these as routes) holds **route-private** components.
- Use `_components/` when the route owns **2 or more** page-specific components. Below that, just put them inline or import from `lib/components/`.
- Cross-route shared UI lives in `lib/components/` or `@selvajs/ui`.

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
