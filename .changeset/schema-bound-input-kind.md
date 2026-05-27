---
'@selvajs/schemas': minor
---

Rename the input-source kinds and add server-resolved inputs (schema format v2.8.0 → v2.9.0).

`InputSource.kind` now describes **who supplies the value**: `'user'` (the person, in the form), `'client'` (the app in the browser, before the form runs), and `'server'` (looked up on the server at solve time). This renames the previously-shipped `'external'` → `'client'` and the unreleased `'bound'` → `'server'`.

The new `'server'` kind adds two companion fields: `path` (host-defined address handed to the `IBindingResolver`; required when `kind === 'server'`) and `onMissing` (`'fail'` default, or `'default'` to fall back to the input's default value).

The C# `SchemaMigrator` rewrites `external` → `client` and `bound` → `server` on existing schemas pre-deserialization, so saved 2.8.0 definitions load unchanged. Regenerated the TypeScript and C# (`UISchema.Generated.cs`) types; `SchemaVersion` tracks the bump.
