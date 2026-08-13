---
'@selvajs/compute': patch
'@selvajs/server': patch
'@selvajs/selva': patch
---

**Read a schema whose keys came back PascalCase, instead of rendering the definition with no inputs.**

A compute server can return `/grasshopper/schema` with every key capitalized — `Inputs`,
`Layout`, `SchemaVersion` — and answer 200 doing it. `Selva.gha` ILRepack-merges
Newtonsoft, so the `[JsonProperty]` attributes on `UISchema` are a foreign type to a server
serializing with its own Newtonsoft; it reads no attributes and falls back to raw CLR member
names. Nothing threw — `schema.inputs` was just `undefined` everywhere, so the definition
rendered with no inputs and the version gate silently went dead.

`@selvajs/compute` gains `normalizeUISchemaCasing`:

```ts
import { normalizeUISchemaCasing } from '@selvajs/compute/grasshopper';
```

It reproduces Newtonsoft's `CamelCaseNamingStrategy` (`UVMapping` → `uvMapping`) and copies
`options`, `defaultOptions` and `values` verbatim — those keys are the author's dropdown
labels, and rewriting them changes what the definition solves with.

`@selvajs/server` normalizes inside `postSchemaFormData`, so both the upload and render paths
are covered, and adds `assertCamelCaseSchema` as a backstop for schemas persisted before this
fix (a cached schema is re-read straight from the database). It throws `SchemaExtractionError`
with the new `'malformed'` kind. The schema cache now also requires a readable `inputs` array,
not just a matching version, and `mergeComputeDefaults` reports a classified error instead of
dying on `schema.inputs.map(...)`.

`@selvajs/selva` rejects an unreadable schema at upload (422), maps `'malformed'` to 503 as an
operator-side problem, and no longer throws while counting inputs in the add-definition dialog.
