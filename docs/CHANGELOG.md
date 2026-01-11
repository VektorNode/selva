# Changelog & Versioning

Selva uses [Changesets](https://github.com/changesets/changesets) to automatically manage changelogs and semantic versioning across packages.

## Quick Start

### 1. Make your changes

Commit code normally:

```bash
git add .
git commit -m "feat: Add schema validation"
```

### 2. Create a changeset

```bash
pnpm changeset
```

Select affected packages and choose version bump (patch/minor/major).

### 3. Release

```bash
pnpm changeset version
```

This automatically:
- Updates all `CHANGELOG.md` files
- Bumps versions in `package.json`
- Removes changeset files

## Version Bumps

- **patch** — Bug fixes (1.0.0 → 1.0.1)
- **minor** — New features, backward compatible (1.0.0 → 1.1.0)
- **major** — Breaking changes (1.0.0 → 2.0.0)

## Changeset Format

Changesets are automatically created in `.changeset/[id].md`:

```markdown
---
"@selva/core": minor
"@selva/shared": patch
---

Brief description of what changed
```

## Key Commands

```bash
pnpm changeset          # Create a new changeset
pnpm changeset status   # View pending changes
pnpm changeset version  # Apply and release
```

## Plugin Changelog

The C# Plugin (`Plugin/CHANGELOG.md`) is maintained manually. When making Plugin changes:

1. Update `Plugin/CHANGELOG.md` directly
2. Follow the same format as other changelogs
3. Include the change in your commit

Example entry:

```markdown
### Added
- Add new validator for schema definitions

### Fixed
- Fix WebSocket reconnection timeout
```

## Best Practices

1. Create changesets right after committing changes
2. Write clear, user-focused descriptions
3. Don't manually edit package CHANGELOG files—they're auto-generated
4. Update Plugin CHANGELOG manually
5. Review changesets and changelog updates in PRs

## References

- [Changesets Docs](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
