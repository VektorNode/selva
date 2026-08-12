---
'@selvajs/schemas': minor
---

Harden the schemas package (schema format v2.13.0 → v2.14.0, no data transform).

- **The schemaVersion guard now actually works.** The old canonicalisation used `JSON.stringify`'s array-replacer form, which filters keys at every nesting level — every definition serialised as `{}`, so property-level schema edits never triggered the "bump schemaVersion" error. The guard now lives in one shared module (`scripts/lib/version-guard.js`, previously copy-pasted into both generators), deep-sorts and compares real content, ignores doc-only edits (descriptions, section comments), and runs against the PR base branch in CI via `SCHEMA_GUARD_BASE_REF` — previously it could never fire in CI at all.
- **GUID fields are explicit.** C# `System.Guid` mapping now comes from `format: "guid"` in the schema, not from sniffing description text for the word "GUID" (a doc rewording could silently change a C# type). Generated C# is byte-identical.
- **Type guards and aliases are derived from the LayoutItem union** instead of hand-maintained lists in the generator — a new variant gets its guard and alias membership for free. Output-widget guards are now complete and consistently named `is<Widget>OutputWidget`; the lone previous output guard `isImageWidget` (unused) is renamed `isImageOutputWidget`. `STRING_ALIAS_TYPES` in the C# generator is likewise derived.
- **Section-comment keys in ui-schema.json are unique.** Seven duplicate `"//_COMMENT"` keys meant JSON.parse silently kept only the last; a schema-integrity test now enforces uniqueness, resolvable `$ref`s, and union discriminators.
- The package now has its own vitest suite (traversal, defaults, version guard, schema integrity), `sideEffects: false`, and JSON subpath exports (`@selvajs/schemas/ui-schema.json`, `@selvajs/schemas/preset-schema.json`). The redundant `generate:all` alias is gone — use `pnpm generate`.
