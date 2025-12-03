# Contributing to Selva

Thanks for your interest in contributing! This guide covers the essentials to get you started.

## Getting Started

For setup and environment configuration, see [docs/quickstart](./docs/quickstart).

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
- Run `./generate-schemas.sh` to regenerate C# and TypeScript
- Generated files: `packages/builder/src/lib/types/generated/schema.ts` and `Plugin/Models/Generated/UISchema.Generated.cs`

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
- Run `pnpm test:watch` during development

## Issues & PRs

- Keep issue descriptions concise - what needs to be solved and why
- PRs should reference related issues
- Aim for small, focused changes over large refactors
