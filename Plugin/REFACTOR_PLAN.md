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

## Phase 4 — Flatten `UIBuilder/Services/`

Currently 6 files at the top + 7 subfolders, 5 of them with **one file each**. The mix invites duplication: `BridgeCommunicationService` (top) coexists with `Communication/CommunicationHandler`; `SchemaPersistenceService` (top) coexists with `Schema/SchemaManager`.

**Action**: collapse all single-file subfolders into the top level. Keep `Communication/` and `Schema/` (they earn their keep with 3+ and 4 files respectively).

Single-file folders to dissolve:
- `Events/DocumentEventManager.cs` → `Services/DocumentEventManager.cs`
- `Persistence/ValueApplicator.cs` → `Services/ValueApplicator.cs`
- `State/ComponentStateManager.cs` → `Services/ComponentStateManager.cs`
- `UI/ComponentMessageFormatter.cs` → `Services/ComponentMessageFormatter.cs`
- `Values/ValueCollector.cs` → `Services/ValueCollector.cs`

Follow-up code task (separate from this refactor): read `BridgeCommunicationService` ↔ `CommunicationHandler` and `SchemaManager` ↔ `SchemaPersistenceService`. They likely overlap. Out of scope for this phase — file moves only here.

## Phase 5 — Move `OBSOLETE_COMPONENTS_GUIDE.md`

`Plugin/Selva.GH/Features/OBSOLETE_COMPONENTS_GUIDE.md` → `docs/development/obsolete-components.md`. Lowercase kebab-case, lives in `docs/`. Add a link from `Plugin/README.md`.

## Phase 6 — Rename `Plugin/Dist/` → `Plugin/Releases/`

`Dist/` is checked-in versioned `.yak` releases (not build output). Rename for clarity. Update `scripts/build-production.js`, `scripts/setup.sh`, `scripts/update.sh`, and any docs that reference the path.

## Phase 7 — Root cleanup

- [ ] Delete `tsconfig.lib.json` (referenced nowhere — verified via grep).
- [ ] Rename `example.ecosystem.config.cjs` → `ecosystem.config.example.cjs` (convention: `.example` as suffix, not prefix).
- [ ] Move `Caddyfile.example` → `infra/Caddyfile.example` or `docs/deployment/`.
- [ ] Decide on `examples/` (currently one HTML file): populate or fold into `docs/`.

## Phase 8 — Reorganize `@selvajs/ui` `lib/utils/`

`utils/` is currently a junk drawer (compute helpers, schema helpers, generic helpers, plus a `utils-shared.ts` for one tiny function next to a `utils.ts` for shadcn's `cn()`).

| File | New home |
|---|---|
| `color.ts`, `debounce.ts`, `loadScript.ts`, `file-download.ts` | stay in `utils/` (truly generic) |
| `utils.ts` (shadcn `cn`) | leave alone (shadcn convention) |
| `computeThrottle.svelte.ts`, `solving.svelte.ts` | move to new `lib/compute/` |
| `param-exporter.ts`, `visibility-rules.ts` | move to new `lib/schema/` |
| `utils-shared.ts` (single `getDefaultValue`) | inline at call sites or move to `lib/schema/defaults.ts` |

Update `packages/ui/package.json` exports if any of these are publicly exported. Update import paths in `builder-app` and `compute-app`.

## Phase 9 — Document `builder-app` lib structure

The split between `lib/features/builder/` (TS logic) and `lib/components/builder/` (Svelte UI) is intentional but undocumented. Add a short `packages/builder-app/src/lib/README.md` (3 sentences) explaining the rule. No code changes.

## Phase 10 — Normalize `_components/` convention

Currently 3 routes use `_components/` (`admin/users/`, `library/`, `projects/`); other routes don't. Audit each route in `compute-app/src/routes/`:

- If a route has 2+ page-private components, colocate them in `_components/`.
- Otherwise, leave inline or pull from `lib/components/`.

Small janitorial pass. Lowest priority.

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
