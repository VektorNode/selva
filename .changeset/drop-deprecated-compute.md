---
'@selvajs/compute': major
'@selvajs/server': minor
'@selvajs/selva': patch
---

**Every deprecated symbol in `@selvajs/compute` is gone.** Nothing is left as a stub — this is a
coordinated pre-1.0 major, so there is nothing to ease.

**`camelcaseKeys` and `toCamelCase` are removed from `@selvajs/compute/core`.** They were
deprecated in favour of `readField`, which now takes their export slot alongside `hasField`:

```diff
-import { camelcaseKeys } from '@selvajs/compute/core';
-const { schemas } = camelcaseKeys(entry) as { schemas?: UISchema[] };
+import { readField } from '@selvajs/compute/core';
+const schemas = readField<UISchema[]>(entry, 'schemas');
```

Blanket key-rewriting was the wrong tool for wire payloads: it corrupted user-authored keys
(value-list labels, `Display3d` → `display3d`) while the actual problem — server branches
disagreeing on casing for a handful of known fields — is what `readField` solves per-field.

**If you were unwrapping compute's schema endpoint with it, you had the bug described below.**
Use the new `readSchemaResults` instead of hand-rolling the unwrap:

```diff
-const results = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as { schemas?: UISchema[] }[];
+import { readSchemaResults } from '@selvajs/compute/grasshopper';
+const results = readSchemaResults<UISchema>(raw);
```

**`ComputeConfig.suppressClientSideWarning` is removed.** Use `suppressBrowserWarning`, which it
has been an alias for.

**New: `readSchemaResults` on `@selvajs/compute/grasshopper`** — the one correct way to unwrap
`/grasshopper/schema`'s `[{ FileName, Schemas }]` body.

It exists because everyone who hand-rolled that unwrap got it wrong the same way. The wrapper's
casing varies by server branch (mcneel `FileName`/`Schemas`, our fork `fileName`/`schemas`), so a
fixed-key read yields `undefined` against half of them — and the endpoint answers 200 either way,
so the failure surfaces as "this definition has no schemas". Reaching for `camelcaseKeys` looked
like the fix but passed the response **array** to a shallow key-rewriter, which returns arrays
untouched: same `undefined`, now with a comment claiming it was handled.

That was live in this repo: every upload through `/api/v1/compute/schema` 422'd with "No schemas
found in definition". Fixed here, and `@selvajs/server/definitions` re-exports the helper typed to
`UISchema` so the app layer keeps its concrete type.

`readSchemaResults<TSchema>(raw)` returns `SchemaEndpointResult<TSchema>[]` — `{ schemas?, error? }`
per file. `TSchema` is pass-through; the helper reads only the two wrapper keys and never looks
inside a schema, so `@selvajs/compute` still doesn't depend on `@selvajs/schemas`. Pass your own
schema type, or omit it for `unknown`.

Also removed the unused legacy test builders (`createMockGrasshopperInput` and friends,
`createMockThreeGeometry`) from the package's test helpers.
