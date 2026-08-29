# Project Structure

Where code lives and how it's named. Every refactor and new file conforms to these rules. If the codebase violates one, it's a bug: fix the code or update this doc.

## Repository layout

```
selva/
├── Plugin/                         # .NET / Grasshopper plugin
│   ├── Selva.Schema/               # Schema models, validation, migration (no Rhino/GH deps)
│   ├── Selva.Drawing/              # Document-model drawing library + SVG/PDF renderers (no Rhino/GH deps)
│   ├── Selva.Rhino/                # Rhino interop layer for Selva.Drawing (Rhino/GH deps, no Goos)
│   ├── Selva.GH/                   # Grasshopper plugin (depends on Selva.Schema + Selva.Drawing)
│   ├── Selva.PluginVerifier/       # Post-merge smoke test that loads the built .gha
│   ├── Selva.Tests/                # xUnit tests for Selva.GH + Selva.Schema
│   ├── Selva.Drawing.Tests/        # xUnit tests for Selva.Drawing
│   └── Releases/                   # Local build output only, NOT tracked; releases ship via plugin-release.yml
│
├── packages/                       # TypeScript / Svelte workspace
│   ├── schemas/                    # ui-schema.json + TS/C# code generators
│   ├── compute/                    # @selvajs/compute: Rhino.Compute client + data-tree helpers (no three)
│   ├── visualization/              # @selvajs/visualization: headless viewer core (scene/render/parse/shared)
│   ├── solve/                      # @selvajs/solve: the solve flow, both sides of the wire (client/server/shared)
│   ├── platform/                   # Provider interfaces (auth, data, storage, ...)
│   ├── providers/
│   │   ├── local/                  # Filesystem-backed provider (@selvajs/local-provider)
│   │   ├── supabase/               # Supabase provider (@selvajs/supabase-provider)
│   │   └── header-auth/            # Forward-auth provider (@selvajs/header-auth-provider)
│   ├── server/                     # @selvajs/server: server building blocks (limits, rate limit, SSRF guard, definitions)
│   ├── ui/                         # Shared Svelte components, theme, primitives
│   ├── plugin-ui/                  # Plugin UI: schema designer + preview, embedded into Selva.gha
│   ├── selva/                      # @selvajs/selva: deployable Selva app (cloud mode)
│   ├── website/                    # @selvajs/website: docs/marketing site
│   ├── cli/                        # @selvajs/cli: scaffold and operate a Selva deployment
│   └── config/                     # Shared ESLint/Vite/Vitest/Prettier config
│
├── docs/                           # Project documentation, grouped by audience
│   ├── self-hosting/               # Operators: deploy and run the Selva app
│   ├── packages/                   # Developers building on @selvajs/*
│   ├── contributing/               # Repo-only: build, test, release
│   └── adr/                        # Architecture decision records
├── infra/                          # Terraform, deployment configs
├── scripts/                        # Build and setup scripts
└── .github/                        # Issue templates, workflows
```

## .NET / C# conventions

### Project boundaries

| Project                | Target            | Rhino/GH deps | Purpose                                                          |
| ---------------------- | ----------------- | ------------- | ---------------------------------------------------------------- |
| `Selva.Schema`         | `netstandard2.0`  | none          | Generated schema, validation, migration, shared constants        |
| `Selva.Drawing`        | `netstandard2.0`  | none          | Document model + SVG/PDF renderers                               |
| `Selva.Rhino`          | `net48/net7/net9` | yes           | Rhino interop adapter for `Selva.Drawing`                        |
| `Selva.GH`             | `net48/net7/net9` | yes           | `.gha` plugin: all GH components, params, Goos, server lifecycle |
| `Selva.PluginVerifier` | `net48/net7/net9` | yes           | Loads the merged `.gha` after a Release build; Windows-only      |
| `Selva.Tests`          | `net8.0` (xUnit)  | none          | Tests for `Selva.GH` + `Selva.Schema`                            |
| `Selva.Drawing.Tests`  | `net8.0` (xUnit)  | none          | Tests for `Selva.Drawing`                                        |

Rhino 8 loads `net48` + `net7.0`; Rhino 9 loads `net9.0`. Rhino 7 is not supported.
`Selva.Rhino` and `Selva.PluginVerifier` use the `-windows` variants (`net7.0-windows`,
`net9.0-windows`) since they pull in WinForms. On non-Windows, `Selva.GH` builds `net7.0` only.

### NuGet versions live in one file

`Plugin/Directory.Packages.props` declares every version; csprojs carry bare
`<PackageReference Include="..."/>` with no `Version`. Adding a package means adding a
`<PackageVersion>` there first: a reference without one fails the build rather than resolving to
something arbitrary.

This is central package management, adopted because a split version is invisible until restore: a
bump once landed in `Selva.Drawing` alone and left `Selva.GH`/`Selva.Rhino` behind, and the solution
stopped restoring entirely with NU1605. One declaration per package makes that unrepresentable.

Two packages are deliberately held back, each with the reason inline in the props file, and both are
in `dependabot.yml`'s ignore list so the bump is not re-proposed weekly:

- **`System.Drawing.Common`**: 8.0.0. On `net7.0`, 10.x duplicates types already in the framework's
  `System.Drawing.Primitives`, so every `ColorTranslator` use fails with CS0433. Gated on dropping
  Rhino 8.
- **`Grasshopper`**: the Rhino 8 SDK by default, with `VersionOverride` on the `net9.0` references
  for the Rhino 9 `-wip` line. This is the one package with a legitimate per-TFM split; use
  `VersionOverride` on the reference rather than a second `<PackageVersion>` entry.

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

**Exception: `IGH_ContextualParameter` types.** `GetValueListParameter` and `GetDynamicValueListParameter` (`Features/ComputeIO/Components/`) are `IGH_Param` subclasses but skip the `Param_PascalCase` pattern and live in `Components/` rather than `Params/`. This isn't cosmetic: `Param_*` types (`Param_FileData`, `Param_ThreeMaterial`, ...) derive from `GH_PersistentParam<T>` and are standalone canvas nodes a user drops and wires. `IGH_ContextualParameter` types derive from plain `GH_Param<T>` and are never placed as a node; Grasshopper injects them into another component's context menu instead. Naming and placing them like a wire-able param would misrepresent what they are, so don't use this as precedent for a regular `Param_*` type: the exception applies only to `IGH_ContextualParameter`.

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

A feature folder may also have a small growth area beyond this base layout (e.g. `Preview/` for Display or `Helpers/` for UIBuilder, alongside `Services/`), subject to the same "[folder earns its keep](#when-does-a-folder-earn-its-keep)" rule below. `Goos/` may also hold non-Goo support types that exist only to serialize a Goo's payload (e.g. a JSON converter or a plain DTO record); these stay next to the Goo they support rather than moving to `Services/`.

### Changing a component's parameters (obsolete + upgrader)

**Adding or removing an input/output param on a released component requires a new `ComponentGuid`.** Grasshopper stores wire connections in the `.ghx` by parameter _index_, not by name. Keeping the same GUID while the param list shifts silently rewires saved definitions to the wrong inputs; this happened once already and is recorded in [Plugin/CHANGELOG.md](./Plugin/CHANGELOG.md) under 0.11.2.

Cosmetic edits (description, nickname, default value, `SolveInstance` behaviour) do **not** need this: only changes to the number, order, type, or access of params do.

**CI enforces this.** `scripts/check-component-signatures.mjs --check` compares every live component's param signature against the committed snapshot ([Plugin/Selva.GH/component-signatures.json](./Plugin/Selva.GH/component-signatures.json)) and fails on a structural change to an existing GUID. After following the procedure below (or adding a new component), bless the new state with `node scripts/check-component-signatures.mjs --update`.

The procedure:

1. **Snapshot the old shape** into `Features/<Name>/OBSOLETE/` as `OBSOLETE_<Component>_UntilV<X_Y_Z>.cs`. It keeps the **original** `ComponentGuid`, its original `RegisterInputParams`/`RegisterOutputParams`/`SolveInstance`, and gains `public override GH_Exposure Exposure => GH_Exposure.hidden;` so it loads but never appears in the ribbon.
2. **Give the live component a fresh `ComponentGuid`** and its new param list.
3. **Write an upgrader** in the same `OBSOLETE/` folder, named `GH_<Component>Upgrader_To_<X_Y>`, implementing `IGH_UpgradeObject` with `UpgradeFrom` = old GUID, `UpgradeTo` = new GUID, and `Version` = the release date. Use `GH_ComponentUpgradeHelper` ([Selva.GH/Utilities/UpgradeHelper.cs](./Plugin/Selva.GH/Utilities/UpgradeHelper.cs)) to remap indices; it also carries over internalized data, graft/flatten/simplify flags, and expressions:

   ```csharp
   var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
   return helper
       .MapInput(0, 0)   // Geo
       .MapInput(1, 1)   // Name
       // new input at index 2, left empty
       .MapInput(2, 3)   // Metadata → shifted
       .MapOutput(0, 0)
       .Execute();
   ```

   Grasshopper discovers `IGH_UpgradeObject` types by assembly scan; there is no registration list to edit. Comment each `MapInput` with the param name, since the indices are otherwise unreadable.

4. **Chain, don't rewrite.** Each upgrader hops one GUID. Old upgraders stay forever so a v0.6 file can walk 0.6 → 0.9 → 0.14 → 0.16. See `GH_WebDisplayUpgrader.cs` for a four-hop chain.
5. **Record both** in `Plugin/CHANGELOG.md` under **Upgraders** and **Obsolete components**.

### When does a folder earn its keep?

- A subfolder must contain **at least 3 files** at creation, OR
- Be a documented growth area (state the expectation in a `README.md` inside the folder).

One-file folders are a code smell. If `State/` has one file and the file moves to `Services/`, delete `State/`.

## TypeScript / Svelte conventions

### A word used throughout: seam

Package READMEs and the ADRs talk about a **seam**. It means a deliberate joint where one
implementation can be swapped for another without the code around it changing: an interface plus
the injection point that fills it. `SolveDriver` is the transport seam: the session calls it and
never learns whether the answer came over HTTP or a WebSocket. The logger seam lets a host supply
its own logger instead of the default.

A seam is a design commitment, not an accident. Adding or moving one changes what a package
promises, so it belongs in review.

### Per-package `src/lib/` shape

This is the shared vocabulary. Not every package uses every folder, but when a folder appears, it means the same thing everywhere:

| Folder              | What goes there                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/`       | Svelte components                                                                                              |
| `composables/`      | Reactive helpers (`.svelte.ts` files using runes)                                                              |
| `contexts/`         | Svelte context providers (typically `.svelte.ts`)                                                              |
| `features/<name>/`  | Pure TS logic for a feature (no Svelte): operations, config, types                                             |
| `server/`           | Server-only code (SvelteKit `.server.ts` modules), only in apps                                                |
| `stores/`           | Global reactive state, only when not tied to a single feature                                                  |
| `theme/`, `styles/` | Design tokens, CSS, theme runtime                                                                              |
| `types/`            | Cross-cutting TS types (single-feature types live with the feature)                                            |
| `utils/`            | **Generic** helpers only (debounce, color, file-download). Categorical helpers live in feature/domain folders. |

### `features/` vs `components/`

`lib/features/<name>/` holds pure TS (operations, config, types); `lib/components/<name>/` holds the Svelte UI for the same feature. UI imports from logic, never the reverse.

### `utils/` is not a junk drawer

Domain-specific helpers go in their domain folder (`lib/compute/`, `lib/schema/`, etc.). `utils/` is for truly generic helpers with no domain assumptions (debounce, color, file-download).

A domain folder named after the domain itself (`lib/compute/`, `lib/schema/`) is equivalent to a `features/<name>/` folder: both hold pure TS for one concern. Prefer `features/<name>/` for new domains; an existing top-level domain folder isn't required to move under `features/` on its own.

### Routes (`selva/src/routes/<route>/`)

- `_components/` (underscore prefix, so SvelteKit ignores these as routes) holds **route-private** components.
- Use `_components/` when the route owns **2 or more** page-specific components. Below that, just put them inline or import from `lib/components/`.
- Cross-route shared UI lives in `lib/components/` or `@selvajs/ui`.

## Cross-stack contracts (plugin ↔ UI)

The plugin (C#) and UI (TS) are two implementations of one contract over WebSocket / Rhino.Compute. Rules to prevent drift:

- **One source of truth per shape.** `ui-schema.json` generates both stacks (CI fails on drift). For non-generated wire shapes, use a single Rhino-free payload type shared by both paths; a `*ContractTests` test asserts they match.
- **One canonical location per concept.** Outputs live in `schema.Outputs`, canonicalized by `SchemaOutputCanonicalizer` at the boundary. Readers never tolerate "either/or".
- **Keep decisions out of Rhino types.** Pull pure logic into Rhino-free classes (see `OutputPayloadBuilder`, `SchemaOutputCanonicalizer` in `Selva.GH/Features/UIBuilder/Services/`, exercised by `*ContractTests`/`*CanonicalizerTests` in `Selva.Tests`); leave only unwrap/IO in GH-typed shells.

### Adding a new output type

1. **Schema**: add to `ui-schema.json`, run `pnpm generate` at the repo root.
2. **C# Goo**: `*Goo : ISelvaSerializableGoo` with a Rhino-free payload type for the wire shape.
3. **C# collect**: branch in `OutputPayloadBuilder` + golden row in `OutputPayloadContractTests`. Don't add a new extractor in `ValueCollector`.
4. **C# canonicalize**: if it can appear in layout, mirror into `schema.Outputs` in `SchemaOutputCanonicalizer` + invariant test.
5. **TS**: handle the new payload in the UI consumer + a vitest.
6. `dotnet test` and `pnpm test` must both be green.

## File formats Selva owns

Every format has three names with different lifetimes. The **magic bytes** are the identity of
files already on users' disks: frozen forever. The **extension** is what writers emit; renaming
it is cheap (readers detect by magic) but readers must accept retired extensions forever. The
**human name** in UI and docs can change freely.

| Format           | Extension            | Magic            | Spec                                                        |
| ---------------- | -------------------- | ---------------- | ----------------------------------------------------------- |
| Mesh batch blob  | wire-only            | `SLVA` / `SLVZ`* | `SlvaWriter.cs` header / `docs/contributing/slva-format.md` |
| Selva mesh file  | `.slvm` (was `.dmf`) | `DMF1`           | `SlvmFile.cs` header, JSON sidecar + SLVA/SLVZ blob         |
| Parameter preset | `.slvp` (was `.sps`) | none (JSON)      | `packages/schemas/preset-schema.json`                       |

\* `SLVZ` is `SLVA` in an optional DEFLATE container; decoders sniff which by the leading magic.

Naming rule for new formats: human name **"Selva _thing_ file"**, extension **`slv` + one
mnemonic letter**, magic four ASCII bytes. Retired extensions (`.dmf`, `.sps`) stay accepted on
every read path; only writers moved to the `slv*` names. Cross-stack golden fixtures for these
formats live in `packages/schemas/fixtures/` (see "Where fixtures live").

## Where TypeScript tests live

Unit tests go in a `__tests__/` folder beside the code, named `*.test.ts`
(`src/compute/rate-limit.ts` → `src/compute/__tests__/rate-limit.test.ts`).
`*.spec.ts` is reserved for Playwright specs under `e2e/`. Cross-suite fixtures
and setup files go in a package-level `tests/`.

### Where fixtures live

A fixture goes in a `fixtures/` directory at the narrowest scope all its
consumers share:

- **One suite** → `__tests__/fixtures/` beside the test that reads it.
- **Several suites in one package** → `tests/fixtures/` (data) or
  `tests/helpers/` (code that builds test data).
- **Both stacks (TS + C#)** → `packages/schemas/fixtures/`. This is the only
  cross-stack location: `Selva.Tests` resolves it from the repo root, so it
  must stay outside `src/`. These are contract artifacts with an update
  procedure (see the schemas README), not test-private data.
- **Playwright** → `packages/selva/e2e/fixtures/`. Binary `.gh` files there
  need the `.gitignore` negation, since the blanket `*.gh` rule swallows them
  otherwise.

Don't promote a fixture to a wider scope speculatively; move it when a second
consumer appears. Code that constructs test data is a helper, not a data
fixture: colocate it (`__tests__/fixtures.ts`) or put it in `tests/helpers/`.
Assets for `examples/` demos aren't fixtures in this sense and stay under
`examples/`.

The repo-root `fixtures/` is for local development aids no test reads:
Grasshopper definitions for manual plugin testing and their rhino-mcp
regeneration recipes. If a test starts reading one of these files, it becomes
a test fixture: move it to the scope its consumers share.

Every package's `vitest.config.ts` starts from `createVitestConfig()` in
`@selvajs/config/vitest` and overrides only what it can justify.
[docs/contributing/testing.md](./docs/contributing/testing.md) covers the base
config, the provider conformance kits, and why `@selvajs/cli` is exempt.

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
- `CLAUDE.md` is an entrance guide for AI agents working in the repo. It points outward and is
  never the authority for anything: no other document should cite it.
- `CONTRIBUTING.md` is for human contributors.
- `STRUCTURE.md` (this file) is the source of truth for layout/naming.
- [docs/contributing/plugin-context.md](./docs/contributing/plugin-context.md) is the source of truth for Grasshopper canvas wiring and schema identity.
- Package-level developer notes and deep-dives go in `docs/contributing/`, not scattered through package folders. A spec, backlog, or format reference under `packages/` or `Plugin/` is misplaced: move it.
- A package's `README.md` stays with the package: it's the published API surface, and npm renders it.
- `CONTEXT.md` beside its code is the one documented exception: source comments reference it by bare filename, so it has to sit next to what it describes.
- Keep `examples/` for runnable artifacts only.
- `docs/` is grouped by audience, and any doc that can reach the website lives at `audience/group/doc.md`: the folder decides its sidebar group, so there is no `group:` frontmatter to drift. `docs/contributing/` is exempt: it never gets published. See [docs/README.md](./docs/README.md).
