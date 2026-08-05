# Contributing to Selva

Thanks for your interest in contributing! This guide covers the essentials to get you started.

## Getting Started

```bash
pnpm install
pnpm dev              # Terminal 1: web app at http://localhost:5173
cd Plugin && dotnet build  # Terminal 2: plugin dev
```

See [CLAUDE.md](./CLAUDE.md) for full setup details.

## Project Structure

[STRUCTURE.md](./STRUCTURE.md) is the source of truth for where code lives and how it's named — folder layout, C# naming rules, TypeScript package conventions. Read it before adding new files or moving things around.

## Code Style

### General Principles

- **Readability first** - Clear code beats clever code
- **Self-documenting** - Use descriptive names instead of comments for obvious logic
- **Comments for context** - Only comment complex decisions, non-obvious patterns, or important warnings
- Avoid magic values - extract to named constants or configuration

### TypeScript/JavaScript

- Prefer `undefined` over `any` for type safety
- Use ESLint and Prettier for automated formatting
- Keep functions focused and composable

### C#

- Use explicit block syntax - no inline conditionals

  ```csharp
  // Good
  if (condition)
  {
    return value;
  }

  // Avoid
  if (condition) return value;
  ```

### Schema Changes

**Important:** Never edit generated files directly

- Modify `packages/schemas/ui-schema.json`
- Run `pnpm generate` at the repo root
- Generated files: `packages/schemas/src/generated/schema.ts` and `Plugin/Selva.Schema/Models/UISchema.Generated.cs`

## Before You Submit

```bash
# Format code
pnpm format

# Lint and fix issues
pnpm lint:fix

# Type checking
pnpm type-check

# Run tests
pnpm test
```

## Testing

- Write tests that add value - focus on workflows and integration, not trivial cases
- Use tests to document expected behavior and edge cases

## Testing Plugin Changes

After modifying the plugin, rebuild and test:

```bash
cd Plugin && dotnet build
# Then build the .gha file for distribution
pnpm run build:plugin
# Copy to Grasshopper Libraries folder (see CLAUDE.md for path)
```

## Branch Naming

- `feature/description` - new features
- `fix/description` - bug fixes
- `docs/description` - documentation

## Issues & PRs

- Keep descriptions concise - what needs to be solved and why
- PRs should reference related issues
- Aim for small, focused changes
