# Schema Validation Architecture

## Overview

This document describes the validation architecture for Selva's UI schema system, including the design decisions and separation of concerns between frontend and backend validation.

---

## Architecture Principles

### Single Source of Truth
- **All comprehensive validation logic lives in C# backend** (`SchemaValidator.cs`)
- Frontend performs only minimal structural checks
- Backend has final authority on schema validity

### Benefits
- ✅ **No duplication**: Validation logic exists in only one place
- ✅ **Consistency**: Impossible for frontend/backend validation to diverge
- ✅ **Maintainability**: Schema changes only require updating one validator
- ✅ **Type safety**: C# strong typing catches errors at compile time
- ✅ **Simpler frontend**: Less complex TypeScript code

---

## Validation Layers

### Layer 1: Frontend Basic Validation (TypeScript)

**File:** `packages/frontend/src/lib/api/schema-validator.ts`

**Purpose:** Catch obvious structural problems before sending to backend

**Validates:**
- Schema object is not null/undefined
- Required top-level fields exist:
  - `id` (non-empty string)
  - `name` (non-empty string)
  - `inputs` (array, can be empty)
  - `outputs` (array, can be empty)
  - `layout` (object exists)

**Does NOT validate:**
- ❌ Parameter IDs or references
- ❌ Widget configurations (min/max, step size, options)
- ❌ Layout integrity (duplicate IDs, orphaned params)
- ❌ Constraints (version formats, timestamps)
- ❌ Business rules

**Example Usage:**
```typescript
import { validateSchema } from '$lib/api/schema-validator';

const result = validateSchema(schema);
if (!result.isValid) {
  // Show basic errors to user
  console.error('Schema has structural issues:', result.issues);
  return; // Don't send to backend
}

// Send to backend for comprehensive validation
sendToBackend(schema);
```

---

### Layer 2: Backend Comprehensive Validation (C#)

**File:** `Plugin/Features/UIBuilder/Services/Schema/SchemaValidator.cs`

**Purpose:** Comprehensive validation with detailed error messages

**Validates:**

#### Basic Structure ✅
- Schema ID and Name (required, non-empty)
- Inputs and Outputs arrays exist
- Layout exists

#### Parameters ✅
- Parameter IDs are non-empty GUIDs
- No duplicate parameter IDs
- ParamType is specified for each parameter

#### Layout ✅
- Tabs exist and have labels
- Groups exist and have labels
- Groups have valid column counts (> 0)
- Layout items:
  - Have unique IDs
  - Reference valid parameters (input or output)
  - Have valid span values (> 0)
- No orphaned parameters (defined but not in layout)

#### Widget Configurations ✅
- **Number widgets**:
  - `Minimum` < `Maximum`
  - `StepSize` > 0
  - `StepSize` not larger than range (warning)
- **Dropdown widgets**:
  - Have at least one option in `Options` dictionary
- **Other widgets**: No special validation needed

#### Versioning ✅
- Schema version format (semantic versioning: `1.0.0`)
- Plugin version format
- Min plugin version format

#### Constraints ✅
- At least one input or output exists (warning)
- Timestamps are logical (`LastModified` >= `Created`)
- DocumentId is valid GUID format (if present)

**Example Usage:**
```csharp
var validator = new SchemaValidator();
var result = validator.Validate(schema);

if (!result.IsValid)
{
    foreach (var error in result.Errors)
    {
        Logger.Error($"{error.Message}");
    }
    return; // Reject schema
}

foreach (var warning in result.Warnings)
{
    Logger.Warning($"{warning.Message}");
}

// Schema is valid, proceed with saving
```

---

## Validation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User creates/modifies schema in web UI                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Frontend: Basic structural validation (schema-validator.ts)  │
│    - Check required fields exist                                │
│    - Check types are correct (arrays, objects)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                 ┌───────┴────────┐
                 │                │
           ✅ Valid          ❌ Invalid
                 │                │
                 │                ▼
                 │    ┌───────────────────────┐
                 │    │ Show error to user    │
                 │    │ Don't send to backend │
                 │    └───────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Send schema to backend via WebSocket                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend: Comprehensive validation (SchemaValidator.cs)       │
│    - Validate parameters, layout, widgets, constraints          │
│    - Return detailed ValidationResult with errors/warnings      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                 ┌───────┴────────┐
                 │                │
           ✅ Valid          ❌ Invalid
                 │                │
                 │                ▼
                 │    ┌──────────────────────────────────┐
                 │    │ Send ValidationResult to frontend │
                 │    │ with detailed error messages      │
                 │    └──────┬───────────────────────────┘
                 │           │
                 │           ▼
                 │    ┌──────────────────────────┐
                 │    │ Frontend displays errors │
                 │    │ User fixes issues        │
                 │    └──────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Backend saves schema to .gh file                             │
│    - Embedded in Grasshopper document                           │
│    - Persisted with Write(GH_IWriter)                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Why Not Duplicate Validation?

**Considered:** Having identical validation in both TypeScript and C#

**Rejected because:**
- Doubles maintenance burden
- Easy for logic to diverge (bugs, forgotten updates)
- TypeScript can't catch all type errors C# can
- Property names differ (C# uses PascalCase `Minimum`, TS uses camelCase `min` after JSON serialization)
- Type systems differ (C# `Guid` vs TS `string`)

### Why Not Only Frontend Validation?

**Considered:** Only validate in frontend, trust all data from web UI

**Rejected because:**
- Backend must never trust client data (security)
- User could bypass frontend (manual API calls, modified client)
- C# is authoritative for .gh file format
- Schema migration happens in C#, needs validation there

### Why Not Only Backend Validation?

**Considered:** No frontend validation, send everything to backend

**Rejected because:**
- Poor UX: unnecessary network round-trips for obvious errors
- Wastes backend resources validating malformed data
- Slower feedback loop for user

**Solution:** Layered validation with minimal frontend checks

---

## Common Validation Errors

### Frontend Errors (Structural)

```typescript
// Error: Schema is null
validateSchema(null)
// → { isValid: false, issues: [{ message: "Schema is null or undefined" }] }

// Error: Missing required fields
validateSchema({ id: "" })
// → { isValid: false, issues: [{ message: "Schema ID is required" }, ...] }

// Error: Wrong types
validateSchema({ id: "abc", name: "Test", inputs: "not-an-array" })
// → { isValid: false, issues: [{ message: "Inputs array is invalid" }] }
```

### Backend Errors (Comprehensive)

```csharp
// Error: Invalid widget config
var schema = new UISchema {
    Layout = new LayoutConfig {
        Tabs = [
            new TabConfig {
                Groups = [
                    new GroupConfig {
                        Items = [
                            new InputNumberLayoutItem {
                                Config = new NumberWidgetConfig {
                                    Minimum = 100,
                                    Maximum = 10  // ❌ Min > Max
                                }
                            }
                        ]
                    }
                ]
            }
        ]
    }
};

var result = validator.Validate(schema);
// → IsValid = false
// → Errors: "Invalid min/max range: minimum (100) >= maximum (10)"
```

---

## Testing Validation

### Frontend Tests

```typescript
import { validateSchema, ValidationSeverity } from '$lib/api/schema-validator';

describe('SchemaValidator', () => {
  it('should reject null schema', () => {
    const result = validateSchema(null);
    expect(result.isValid).toBe(false);
  });

  it('should accept valid basic structure', () => {
    const schema = {
      id: 'test-id',
      name: 'Test Schema',
      inputs: [],
      outputs: [],
      layout: { tabs: [] }
    };
    const result = validateSchema(schema);
    expect(result.isValid).toBe(true);
  });
});
```

### Backend Tests

```csharp
[TestFixture]
public class SchemaValidatorTests
{
    [Test]
    public void Validate_InvalidMinMax_ReturnsError()
    {
        var schema = CreateSchemaWithNumberWidget(min: 100, max: 10);
        var validator = new SchemaValidator();

        var result = validator.Validate(schema);

        Assert.That(result.IsValid, Is.False);
        Assert.That(result.Errors, Has.Some.Matches<ValidationIssue>(
            e => e.Message.Contains("min/max range")));
    }
}
```

---

## Future Considerations

### Potential Enhancements

1. **Validation Caching**: Cache validation results to avoid re-validating unchanged schemas
2. **Incremental Validation**: Only re-validate changed parts of schema
3. **Custom Validators**: Allow plugins to register custom validation rules
4. **Validation Telemetry**: Track common validation errors for UX improvements

### Schema Evolution

When adding new fields or widget types:

1. Update `ui-schema.json` (source of truth)
2. Regenerate types: `./generate-schemas.sh`
3. Add validation logic to `SchemaValidator.cs` (C# only)
4. Add tests for new validation rules
5. Update this document

**No frontend validator changes needed** - it only checks basic structure!

---

## Related Documentation

- [SCHEMA_EVOLUTION_GUIDE.md](./SCHEMA_EVOLUTION_GUIDE.md) - How to evolve the schema
- [SCHEMA_CHANGELOG.md](./SCHEMA_CHANGELOG.md) - Version history
- [FIXES_APPLIED.md](./FIXES_APPLIED.md) - Recent fixes and architecture decisions
- [CLAUDE.md](../CLAUDE.md) - Overall project documentation

---

## Summary

**Frontend validation:**
- ✅ Minimal structural checks
- ✅ Fast feedback for obvious errors
- ✅ ~150 lines of simple code

**Backend validation:**
- ✅ Comprehensive validation
- ✅ Type-safe with C# strong typing
- ✅ Single source of truth
- ✅ ~400 lines of detailed validation

**Result:**
- Simple, maintainable architecture
- Clear separation of concerns
- Consistent validation behavior
- Easy to extend and test
