---
'@selvajs/plugin-ui': major
---

**Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
aliases left behind. Every reference across the workspace was updated in the same commit.

```diff
-import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
+import type { ParamType, InputStructure } from '@selvajs/schemas';
```

Reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
itself is just a bare string, backend-specific by convention rather than by type).
