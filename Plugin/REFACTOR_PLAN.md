# Plugin Refactor Plan

Tracks the structural cleanup of the `Plugin/` workspace. Each phase ships independently. Delete this file once all phases are done and merged.

The conventions everything below conforms to live in [../STRUCTURE.md](../STRUCTURE.md). If a rule here conflicts with `STRUCTURE.md`, `STRUCTURE.md` wins.

---

## Phase 0 — Conventions doc ✅

Wrote [../STRUCTURE.md](../STRUCTURE.md) (folder layout, C# naming rules, TS package conventions, filename casing). Linked from `CLAUDE.md` and `CONTRIBUTING.md`.

## Phase 1 — Rename `Selva.Core` → `Selva.Schema` ✅

The project was always just schema. Rename makes the boundary self-documenting.

- [x] Folder + `.csproj` renamed.
- [x] `<RootNamespace>` updated.
- [x] Solution file (`Selva.sln`) updated.
- [x] `<ProjectReference>` in `Selva.GH.csproj` and `Selva.Tests.csproj` updated.
- [x] All 39 `.cs`/`.md` files in `Plugin/` rewritten (`namespace Selva.Core` → `Selva.Schema`, `using Selva.Core` → `Selva.Schema`).
- [x] `packages/schemas/scripts/generate-csharp.js` (output path + emitted namespaces).
- [x] `turbo.json`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/Turborepo.md`, `.github/copilot-instructions.md`, `packages/schemas/README.md`, `packages/compute-app/specs/Architecture.md`.
- [x] `dotnet build` clean (0 errors).
- [x] `dotnet test` — 65 / 65 pass.

## Phase 2 — Normalize C# component naming ✅

Rules applied (from `STRUCTURE.md`): filename matches class name, no `snake_case`, no Pascal-case typos. All `ComponentGuid` values were preserved — existing user `.gh` files keep working.

Done:

| From | To | Notes |
|---|---|---|
| `Drawing/Components/CombineToSvg.cs` | `GH_CombineToSvg.cs` | filename only |
| `Drawing/Components/CreateSvgCurve.cs` | `GH_CreateSvgCurve.cs` | filename only |
| `Drawing/Components/CreateSVGSurface.cs` | `GH_CreateSvgSurface.cs` | filename caps fix |
| `Drawing/Components/CurveInfo.cs` | `GH_CurveInfo.cs` | filename only |
| `Drawing/Components/ExportSvgFile.cs` | `GH_ExportSvgFile.cs` | filename only |
| `Drawing/Components/LinearDimension.cs` | `GH_LinearDimension.cs` | filename only |
| `Drawing/Components/PathStyle.cs` | `GH_PathStyle.cs` | filename only |
| `FileIO/Components/GH_Block_To_File.cs` | `GH_BlockToFile.cs` | file + class (also doc-comment in `Param_FileData.cs`) |
| `ComputeIO/Components/GH_Contextual_Value_List.cs` | `GetValueListParameter.cs` | filename now matches the actual class (`GetValueListParameter`, an `IGH_Param`) |
| `ComputeIO/Components/GH_Environement.cs` | `GH_Environment.cs` | file + class + typo fix |
| `Selva.GH/Config/Rhinoconverteroptions.cs` | `RhinoConverterOptions.cs` | filename only (case-rename via `git mv -f`) |

`dotnet build` clean (0 errors), `dotnet test` 65/65 pass.

## Phase 3 — Goos and Params into dedicated folders ✅

8 files moved (`git mv` rename-tracked) into per-feature `Goos/` and `Params/` folders. Namespaces aligned to folders. The empty `UIBuilder/Models/` folder was removed.

Moved:

| File | New location |
|---|---|
| `ComputeIO/Components/ValueListGoo.cs` | `ComputeIO/Goos/ValueListGoo.cs` |
| `Display/Services/ThreeMaterialGoo.cs` | `Display/Goos/ThreeMaterialGoo.cs` |
| `Display/Services/WebDisplayGoo.cs` | `Display/Goos/WebDisplayGoo.cs` |
| `FileIO/Services/FileDataGoo.cs` | `FileIO/Goos/FileDataGoo.cs` |
| `FileIO/Services/FileInputGoo.cs` | `FileIO/Goos/FileInputGoo.cs` |
| `UIBuilder/Models/UISchemaGoo.cs` | `UIBuilder/Goos/UISchemaGoo.cs` |
| `Display/Components/Param_ThreeMaterial.cs` | `Display/Params/Param_ThreeMaterial.cs` |
| `FileIO/Components/Param_FileData.cs` | `FileIO/Params/Param_FileData.cs` |

Consumer `using` directives updated across ~17 files (Components, OBSOLETE upgraders, ValueCollector, ValueApplicator, BridgeCommunicationService, etc.). `dotnet build` clean, `dotnet test` 65/65.

## Phase 4 — Flatten `UIBuilder/Services/` ✅

5 single-file subfolders (`Events/`, `Persistence/`, `State/`, `UI/`, `Values/`) dissolved into `Services/`. `Communication/` (3 files) and `Schema/` (4 files) kept — they earn their keep. 13 stale `using` directives removed across 6 consumer files.

`Services/` now: 11 files at top level + 2 multi-file subfolders. `dotnet build` clean, `dotnet test` 65/65.

Follow-up code task (separate refactor, not part of this plan): inspect for likely overlap between `BridgeCommunicationService` ↔ `CommunicationHandler` and `SchemaManager` ↔ `SchemaPersistenceService`. Possibly merge.

## Phase 5 — Move `OBSOLETE_COMPONENTS_GUIDE.md` ✅

Moved to `docs/development/obsolete-components.md` (kebab-case, no SCREAMING_SNAKE). Linked from `Plugin/README.md` under a new "Development" section that also points to `STRUCTURE.md`.

## Phase 6 — Rename `Plugin/Dist/` → `Plugin/Releases/` ✅

Folder renamed via `git mv`. All versioned `.yak`/`.gh` artifacts tracked as renames. Confirmed via grep that no scripts or docs reference the old `Plugin/Dist/` path — nothing else needed updating.

## Phase 7 — Root cleanup ✅

- [x] Deleted `tsconfig.lib.json` — confirmed unreferenced anywhere; root `tsconfig.json` extends `tsconfig.base.json`. `pnpm type-check` clean across all 11 packages.
- [x] Renamed `example.ecosystem.config.cjs` → `ecosystem.config.example.cjs`. Updated 2 doc references (`docs/deployment/compute-app/NODE_DEPLOYMENT.md`, `packages/compute-app/specs/Architecture.md`).
- [x] Moved `Caddyfile.example` → `docs/deployment/Caddyfile.example`. No script referenced the example file (only the deployed `/etc/caddy/Caddyfile`).
- [x] `examples/embed-code-generator.html` — kept (user decision).

## Phase 8 — Reorganize `@selvajs/ui` `lib/utils/` ✅

Split the junk drawer into three categorical folders. Generic helpers stay in `utils/`. Domain-specific helpers go to `compute/` or `schema/`.

| Old | New |
|---|---|
| `utils/computeThrottle.svelte.ts` | `compute/computeThrottle.svelte.ts` |
| `utils/solving.svelte.ts` | `compute/solving.svelte.ts` |
| `utils/param-exporter.ts` | `schema/param-exporter.ts` |
| `utils/visibility-rules.ts` | `schema/visibility-rules.ts` |
| `utils/utils-shared.ts` | `schema/defaults.ts` (renamed for clarity — its one function is `getDefaultValue`) |
| `utils/color.ts`, `utils/debounce.ts`, `utils/loadScript.ts`, `utils/file-download.ts` | unchanged (truly generic) |
| `utils.ts` (shadcn `cn`) | unchanged (shadcn convention) |

Updated:
- `lib/index.ts` re-exports (public API surface for `@selvajs/ui`).
- 7 internal `ui` consumers (`ComputeApp`, `ParameterPresetManager`, `TabLayout`, `TabContent`, `Group`, `OutputDisplay`, `ChartOutput`, plus `NumberInput`/`TextInput` for `debounce`).
- One stale path comment in `compute-app/src/lib/server/computeLimits.ts:16`.

External consumer `builder-app/handlers.ts` imports `getDefaultValue` from `@selvajs/ui` (top-level export), so it kept working without changes.

`pnpm type-check` clean (11/11 packages). `pnpm check` clean (8/8, 0 errors, 0 warnings).

**Out-of-scope finding**: `builder-app/src/lib/utils/session.ts:111` has its own local `getDefaultValue` definition — duplicates the one in `@selvajs/ui`. Worth de-duplicating in a follow-up.

## Phase 9 — Document `builder-app` lib structure ✅

Wrote `packages/builder-app/src/lib/README.md` — short table of what lives in each folder, and a brief explanation of why `features/` and `components/` are split (logic vs UI; UI imports logic, never the reverse).

## Phase 10 — Normalize `_components/` convention ✅

Audited every route in `compute-app/src/routes/`. Result of applying the rule "use `_components/` when ≥2 page-private components, otherwise inline":

- `library/` (2 files) — kept `_components/` ✅
- `projects/` (11 files) — kept `_components/` ✅
- `admin/users/` (1 file) — inlined `UserListItem.svelte` next to `+page.svelte`, removed empty `_components/` folder, updated 2 import paths (the page importing it + the component's own `+page.server` type import).
- `admin/system/` (1 file inline) — left as-is. Already conforms.
- All other routes (no page-private components) — nothing to do.

`pnpm check` clean across all 8 packages, 0 errors, 0 warnings.

---

## Suggested ship order

| Phase | Risk | Status |
|---|---|---|
| 0 | None | ✅ Done |
| 1 (Selva.Core → Schema) | Medium | ✅ Done |
| 2 (C# naming) | Medium (GUID risk) | 🚧 Next — split into 3 PRs (Drawing, FileIO, ComputeIO) |
| 3 (Goos/Params) | Low | After 2 |
| 4 (flatten Services) | Low | Independent |
| 5 (OBSOLETE doc) | None | Independent |
| 6 (Dist → Releases) | Low | Independent |
| 7 (root cleanup) | None | Independent |
| 8 (ui/utils) | Medium (imports) | Independent |
| 9 (builder-app docs) | None | Independent |
| 10 (_components) | Low | After 9 |

After all phases land: delete this file.
