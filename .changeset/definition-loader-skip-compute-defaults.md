---
'@selvajs/server': minor
---

`createDefinitionLoader` gains a `skipComputeDefaults` option for callers that read schema structure
rather than rendering a form.

The loader always opened a `GrasshopperClient` and called `getIO`, even when the version row already
carried a fresh cached schema. That is not redundant work — `getIO` is what merges compute default
_values_ into the schema, and those are not persisted at upload — but it is work a structure-only
caller never uses.

The cost lands on list pages. Anything reading only what upload already persisted — input ids,
`source.key`, widget types — pays a compute **connect** per definition to fetch defaults it
discards, and a page resolving several definitions pays it several times over. The connect is the
expensive part, not the `getIO` call it carries.

With `skipComputeDefaults: true`, a version whose cached schema matches `UI_SCHEMA_VERSION` returns
before `getClient` runs, so compute is not contacted at all. The returned shape is unchanged
(`version`, `definitionSource`, `computeServer`, `schema`) — only `schema.inputs[].default` is
absent, which is precisely what the caller opted out of.

The fast path is conservative in both directions. A version with **no** cached schema, or one whose
`schemaVersion` does not match the app's, falls through to the full path — so the result is always a
valid current-format schema, never a stale one, and the ADR 0005 staleness rule still holds. Omitting
the option changes nothing.

**Do not set it for anything that renders a form.** A form built without compute defaults shows the
wrong initial values.

New export: the `DefinitionLoadOptions` type, as a fifth optional parameter on `DefinitionLoader`.
Additive — existing four-argument calls are unaffected.
