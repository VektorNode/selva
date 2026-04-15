# Selva.Core

Shared models and services for the Selva Grasshopper plugin. This library provides the core functionality for schema
management, validation, and versioning.

## Target Framework

- **netstandard2.0** - Compatible with both .NET Framework 4.8 (Rhino 7) and .NET 7.0+ (Rhino 8)

## Dependencies

- Newtonsoft.Json 13.0.3

## Architecture

### Generated Models

[UISchema.Generated.cs](Models/UISchema.Generated.cs) - Auto-generated from `packages/schemas/ui-schema.json`. Contains
type-safe C# models for the entire UI schema structure.

**Do not modify manually.** Regenerate with:

```bash
cd packages/schemas && pnpm run generate:cs
```

### Services

**Schema Validation** - Modular rule-based validation system:

- [SchemaValidator.cs](Services/Validation/SchemaValidator.cs) - Composable validation engine
- [IValidationRule.cs](Services/Validation/IValidationRule.cs) - Interface for custom rules
- [Rules/](Services/Validation/Rules/) - Built-in validation rules (structure, parameters, layout, versioning,
	constraints, widget config)

**Schema Migration** - Version upgrade handling:

- [SchemaMigrator.cs](Services/SchemaMigrator.cs) - Migrates schemas to current version
- [SchemaBackupService.cs](Services/SchemaBackupService.cs) - Creates backups before migrations

### Constants

- [SchemaVersion.cs](Constants/SchemaVersion.cs) - Centralized schema version definition

## Usage

This library is referenced by:

- `Selva.Grasshopper` - Main plugin implementation
- `Selva.Tests` - Unit tests

It provides the shared foundation for schema handling across the Grasshopper plugin.
