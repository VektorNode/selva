# Selva Project – GitHub Copilot Custom Instructions

## 1. Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI for building interactive Grasshopper definitions.

**Architecture:**

- **Monorepo:** Two main stacks managed in a single repository
  - Backend: C# plugin (`Plugin/`) targeting .NET net48 + net7.0 (Rhino 8) and net9.0 (Rhino 9). Rhino 7 is not supported.
  - Frontend: TypeScript/SvelteKit apps in `packages/` for two deployment modes
- **Local Mode** (`@selvajs/builder-app`): Schema designer with WebSocket connection to Grasshopper
- **Cloud Mode** (`@selvajs/selva`): Standalone app using Rhino.Compute for cloud solving
- **Shared** (`@selvajs/ui`): Components, utilities, and theme system

Copilot should use this context when generating code, explanations, review comments, or test scaffolding.

## 2. Tech Stack and Tooling

- **Backend:** C# multi-target — .NET Framework 4.8 + .NET 7.0 (Rhino 8) and .NET 9.0 (Rhino 9)
- **Frontend:** SvelteKit 5 + TypeScript + Tailwind CSS
- **Package Manager:** pnpm >= 10.0.0 (not npm; pinned via `packageManager`, activated via Corepack)
- **Schema:** JSON Schema (`ui-schema.json`) auto-generates C# and TypeScript types
- **Testing:** xUnit for C#, Vitest for TypeScript
- **Production:** PM2 for process management, graceful reload for zero-downtime updates
- **Icons:** @lucide/svelte (all icons, no duplication)

## 3. Build, Test, Run, and Validate

**Setup (required first):**

```bash
pnpm install
```

**Backend (C#):**

```bash
cd Plugin
dotnet build                           # Debug build
dotnet build --configuration Release   # Release build
dotnet test                            # Run tests
```

**Frontend (TypeScript/Svelte):**

```bash
pnpm dev                    # Dev server (http://localhost:5173)
pnpm type-check             # TypeScript check
pnpm lint                   # Lint all files
pnpm format                 # Format with Prettier
pnpm build                  # Build all packages (Turborepo, with caching)
```

**Schema workflow (when modifying ui-schema.json):**

```bash
cd packages/schemas && pnpm run generate:all
# Updates: packages/schemas/src/generated/schema.ts
#          Plugin/Selva.Schema/Models/UISchema.Generated.cs
```

**Production build:**

```bash
pnpm run build:plugin  # Builds plugin with embedded web assets
```

**Deployment:**

```bash
pm2 start ecosystem.config.cjs              # Start with PM2
pm2 restart selva-compute --update-env      # Restart after config or env change
```

## 4. Code Style and Conventions

- Write self-documenting code; avoid unnecessary abstractions.
- Comment only complex logic; otherwise rely on clear naming.
- Consistent formatting for C#, TS, and Svelte.
- Follow existing patterns in the repository for naming, modularity, and structure.
  When Copilot suggests code, prioritize consistency with existing idioms.

## 5. Error and Boundary Handling

- Add error handling at system boundaries: user input, external API calls, build/test boundaries.
- Avoid unnecessary try/catch blocks inside pure logic paths.
- Prefer failing loudly in development with clear diagnostics over silent catch-all.

## 6. Commit Message Format

When asked to help generate commit messages:

- Use present tense (“Add feature” not “Added feature”).
- Start with one of: feat, fix, docs, style, refactor, test, chore.
- Keep concise and descriptive.
- If relevant, reference issue number.
- Use bullet points for multiple changes.

## 7. Schema and Type Safety

- **Single source of truth:** `packages/schemas/ui-schema.json` generates both C# and TypeScript
- When adding new types or properties, always update the schema and run `generate:all`
- Never manually edit generated files:
  - `packages/schemas/src/generated/schema.ts`
  - `Plugin/Selva.Schema/Models/UISchema.Generated.cs`
- Type mappings (C# nullable when the property is not in `required`): string → string, number → double / double?, integer → int / int?, boolean → bool / bool?, array → List<T>

## 8. Do Not

- Do not generate code that assumes unspecified new frameworks or tooling not in this repo.
- Do not bypass documented build/test steps or the schema generation workflow.
- Do not assume configurations or conventions not defined in existing config files or docs.
- Do not use npm; always use pnpm.
- Do not manually edit generated schema files; regenerate from source.
- Do not add npm packages without checking lock file updates.

## 9. When Writing Tests or Validation Scripts

- Use existing test frameworks already in the repository (xUnit for C#, Vitest for TS).
- Follow the project’s style for tests.
- Provide clear descriptions and intent in test names.
- Include both positive and edge-case scenarios.

## 10. When Reviewing Code or Explaining Behavior

- Reference the tech stack and conventions above.
- Provide actionable suggestions with code examples that integrate seamlessly.
- Explain architectural decisions (e.g., why types are generated vs manual).
- Reference CLAUDE.md and README files for project context.
