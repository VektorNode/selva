---
'@selvajs/schemas': minor
'@selvajs/platform': minor
---

Unify the `InputSource` address into a single `key` (schema format v2.9.0 → v2.10.0).

`InputSource` is now `{ kind: 'user' | 'client' | 'server', key?: string }`. The previously-separate `path` (server) field, the short-lived `producer` (client) field, and the server-only `onMissing` field are removed in favour of one opaque `key`, interpreted by the host per `kind`:

- `client` → `key` names **which** producer app fills the input (e.g. `'line-app'`, `'file-upload'`) so the host can pre-route to it.
- `server` → `key` names **what** to fetch (e.g. `'capture.geometry'`) for the host's `IBindingResolver`.

`kind` already encodes the push (client/browser) vs pull (server) distinction, so a single `key` next to it is the normalised shape — the host decides how to read it; Selva stays domain-agnostic.

`IBindingResolver.resolve` renames its `paths` parameter to `keys` to match. The C# `SchemaMigrator` (`UnifyInputSourceKey`, run pre-deserialization) folds any saved `path`/`producer` into `key` and drops `onMissing`, so existing schemas load unchanged. Regenerated the TypeScript and C# (`UISchema.Generated.cs`) types; `SchemaVersion` and the migrator registry track the bump (`MigrateTo_2_10_0`).
