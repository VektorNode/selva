---
'@selvajs/compute': major
'@selvajs/schemas': major
'@selvajs/plugin-ui': major
'@selvajs/solve': major
'@selvajs/server': major
'@selvajs/selva': patch
---

**Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
aliases left behind. Every reference across the workspace was updated in the same commit.

```diff
-import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
+import { fetchCompute, ComputeError } from '@selvajs/compute/core';
```

```diff
-import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
+import type { ParamType, InputStructure } from '@selvajs/schemas';
```

Both renamed schema types were already backend-agnostic in value (`ParamType` is
`number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
so this needs a plugin rebuild.

**`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
export) and `@selvajs/visualization` (root deliberately empty):

```diff
-import { GrasshopperClient } from '@selvajs/compute';
+import { GrasshopperClient } from '@selvajs/compute/grasshopper';
```

**Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
(`COMPUTE_*`).

Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
itself is just a bare string, backend-specific by convention rather than by type).
