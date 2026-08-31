# @selvajs/schemas

Single source of truth for the shapes shared between the web UI and the Grasshopper plugin. `ui-schema.json` generates both sides:

- TypeScript: `src/generated/schema.ts` (plus `preset.ts` from `preset-schema.json`)
- C#: `Plugin/Selva.Schema/Models/UISchema.Generated.cs` and `Plugin/Selva.Schema/Constants/SchemaVersion.cs`

Never edit the generated files. Edit the JSON schema and run, from the repo root:

```bash
pnpm generate
```

Generated output is committed; CI regenerates and fails if it is stale.

## Editing the schema

Standard JSON Schema draft-07 under `definitions`. A property is optional unless listed in `required`; optional value types become nullable in C#.

| JSON                             | TypeScript | C# (required) | C# (optional) |
| -------------------------------- | ---------- | ------------- | ------------- |
| `string`                         | `string`   | `string`      | `string`      |
| `number`                         | `number`   | `double`      | `double?`     |
| `integer`                        | `number`   | `int`         | `int?`        |
| `boolean`                        | `boolean`  | `bool`        | `bool?`       |
| `array`                          | `T[]`      | `List<T>`     | `List<T>`     |
| `string` + `format: "date-time"` | `string`   | `DateTime`    | `DateTime`    |
| `string` + `format: "guid"`      | `string`   | `Guid`        | `Guid`        |

Conventions the generators rely on:

- **GUID fields declare `format: "guid"`.** That is the only thing that makes a C# property `System.Guid` — the description is documentation and nothing more.
- **Section comments** are `"//_NAME": "--- ... ---"` pseudo-keys inside `definitions`. Keys must be unique: JSON silently drops duplicate keys on parse. A test enforces this.
- **Top-level string enums** (`ParamType`, `InputStructure`) become TS string unions and plain `string` in C# — the wire value is the lowercase string, never an enum ordinal.
- **Discriminated unions** are `oneOf` refs whose variants carry `const` discriminators (`type`, `widgetType`). The C# generator emits a base class and a JsonConverter per union. The TS generator derives the `InputLayoutItem` / `OutputLayoutItem` aliases and every `is...Widget` guard from the union, so a new variant gets its guard for free — nothing to keep in sync by hand.

## Changing the schema format = version bump

The `default` on `UISchema.properties.schemaVersion` versions the **saved-schema format**; it is what lets the plugin migrate old saved definitions. The generators refuse to run when definitions changed without a bump (`scripts/lib/version-guard.js`). Doc-only edits — descriptions, section comments — don't count as changes.

When you bump:

1. Raise the `schemaVersion` default (e.g. `2.14.0` → `2.15.0`).
2. Add a `MigrateTo_X_Y_Z` entry in `Plugin/Selva.Schema/Services/SchemaMigrator.cs` — a no-op entry documenting the change is fine when no data transform is needed.
3. Add a changeset describing the change.

Locally the guard compares against `HEAD`, so it fires before you commit. In CI the working tree always matches `HEAD`, so the workflow sets `SCHEMA_GUARD_BASE_REF` to the PR's base branch instead.

## Runtime exports

Besides the generated types, the package exports two small modules every schema consumer shares:

- `traversal.ts` — `getGroups` / `getLayoutItems` / `getInputItems`, the single place that knows how to walk a layout (tabbed vs flat). Readers are defensive: missing layout or groups yield empty results, never a throw.
- `defaults.ts` — `getDefaultValue(paramType)`, the value an input carries when the schema provides none.

The JSON schemas themselves are published and importable: `@selvajs/schemas/ui-schema.json`, `@selvajs/schemas/preset-schema.json`.

## Fixtures

`fixtures/` holds wire-format payloads asserted from **both** stacks — test contracts, not published artifacts.

`fixtures/wire/` carries one fixture per outbound WebSocket envelope. The C# side generates them and keeps them honest (`WireFixtureContractTests` serializes every `OutboundEnvelopes` factory and compares byte-for-byte; a reflection test forbids a factory without a fixture), and the TS side validates every fixture against the Zod guards the dispatcher runs on live messages (`plugin-ui`'s `wire-fixtures.test.ts`, which also requires a fixture per validated message type). After an intentional shape change, regenerate with:

```bash
UPDATE_WIRE_FIXTURES=1 dotnet test --filter WireFixtureContractTests
```

`fixtures/slva/` carries golden binary mesh blobs, one per SLVA format variant (quantized, float32, UV/color chunks, uint32 indices, SLVZ container). The C# `SlvaWriter` produces them (`SlvaFixtureContractTests` byte-compares against the committed files) and `@selvajs/visualization`'s `slva-fixtures.test.ts` decodes them against the writer inputs recorded in each `.expected.json`. This is the only place the real C# encoder meets the real TS decoder — the other parser tests consume TS-built bytes. After an intentional format change:

```bash
UPDATE_SLVA_FIXTURES=1 dotnet test --filter SlvaFixtureContractTests
```

The remaining fixtures (`dynamic-value-list-payload.json`) are shared the same way by `packages/ui` and the C# `OutputPayloadContractTests`.

## Testing

```bash
pnpm test
```

Covers layout traversal, input defaults, the version guard's canonicalisation, and `schema-integrity.test.ts`, which validates `ui-schema.json` itself: every `$ref` resolves, every union variant declares its discriminators, comment keys are unique, and the schema version matches the generated `UI_SCHEMA_VERSION`. The generator scripts have no direct tests beyond the guard; their committed output plus the CI regeneration check acts as the snapshot.
