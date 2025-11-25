# Selva Monorepo Guide

This guide explains the structure and workflow of the Selva monorepo.

## 📁 Structure

```
packages/
  ├── core/              # TypeScript library for Rhino Compute Server
  ├── svelte-ui/         # Svelte component library (depends on core)
  ├── builder/           # Web builder application (depends on svelte-ui, core)
  └── schemas/           # TypeScript/C# schema generation

examples/
  ├── svelte-app/        # Example using core package
  └── svelte-template-app/  # Template for new projects
```

## 🔄 Dependency Graph

```
core (independent)
  ↓
svelte-ui (depends on core)
  ↓
web/builder (depends on svelte-ui, core)
```

**Important:** Build packages in dependency order.

## 🚀 Common Commands

### Development

```bash
pnpm dev              # Start web app dev server
pnpm build            # Build core → svelte-ui → web (respects order)
pnpm build:watch      # Watch core package during development
```

### Quality Checks

```bash
pnpm type-check       # TypeScript check across all packages
pnpm check            # Svelte check + type check
pnpm test             # Run all tests
pnpm test:watch       # Watch mode for tests
pnpm lint             # Check code with ESLint
pnpm lint:fix         # Auto-fix linting issues
pnpm format           # Format all code
pnpm format:check     # Check formatting without changes
```

## 📦 Managing Dependencies

### Version Catalogs

Shared dependency versions are defined in `pnpm-workspace.yaml` under `catalogs`. This ensures consistency across packages.

**To update a shared dependency:**

1. Update the version in `pnpm-workspace.yaml`
2. Run `pnpm install` to update lockfile

### Package-Specific Dependencies

If a package needs a unique dependency, add it to that package's `package.json` normally.

## 🏗️ Adding a New Package

1. Create directory in `packages/` or `examples/`
2. Create `package.json` with name like `@selva/package-name`
3. Add to root `pnpm-workspace.yaml` (already set to `packages/*` and `examples/*`)
4. Use shared dependency versions from catalogs when possible

## 📋 Package Responsibilities

### `@selva/core`

- Main TypeScript library
- Rhino Compute Server integration
- Grasshopper automation
- No UI dependencies

### `@selva/svelte-ui`

- Reusable Svelte components
- Depends on `core` for data structures
- Can be published to npm
- UI library focused

### `@selva/web` (builder)

- SvelteKit web application
- Uses both `core` and `svelte-ui`
- Entry point for end users
- Marked as `private` in package.json

## 🔧 TypeScript Configuration

- Base config: `tsconfig.base.json`
- Individual packages extend and customize as needed
- Ensures consistency while allowing flexibility

## 📝 Development Workflow

1. **Make changes** to any package
2. **Test locally** with `pnpm dev` or `pnpm test`
3. **Run quality checks**: `pnpm type-check && pnpm lint && pnpm test`
4. **Commit** with clear messages
5. **Deploy** via CI/CD pipeline

## 🚨 Common Issues

### Package not found errors

- Ensure package is in `packages/` or `examples/`
- Run `pnpm install` from root
- Check circular dependencies

### Version conflicts

- Check `pnpm-workspace.yaml` catalogs
- Use `pnpm list` to inspect dependency tree
- Consider using `pnpm dedupe`

### Build order issues

- Root scripts enforce order: core → svelte-ui → web
- Use `pnpm --filter` for single package operations
- Use `pnpm --parallel` for independent packages

## 📖 pnpm Filter Examples

```bash
# Run script in one package
pnpm --filter @selva/core build

# Run script in all packages matching pattern
pnpm --filter ./packages --recursive run test

# Run in parallel (safe only for independent tasks)
pnpm --filter ./packages --parallel run type-check

# Run in specific order (enforced by --filter, not --parallel)
pnpm --filter @selva/core build && pnpm --filter @selva/svelte-ui build
```

## 🤝 Contributing

When contributing:

1. Changes should respect dependency order
2. Run full quality suite before PR: `pnpm type-check && pnpm lint && pnpm test`
3. Format code: `pnpm format`
4. Update MONOREPO.md if structure changes
