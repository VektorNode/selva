---
'@selvajs/server': minor
---

`isUsableCachedSchema` accepts a stored schema in an older minor of the current major (`2.19.0` under `2.20.0`) without an extraction time, so a minor `UI_SCHEMA_VERSION` bump no longer sends every definition read back to Compute. An older major still needs an extraction within the recheck window. `isOlderMinorSchemaVersion` is exported from `@selvajs/server/definitions`.
