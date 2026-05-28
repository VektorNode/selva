---
'@selvajs/schemas': minor
---

Add dynamic value lists (schema format v2.9.0 → v2.10.0).

A dynamic value list input renders like a dropdown/checklist, but its options are populated at runtime instead of being frozen into the schema at build time. A new `dynamicValueList` output declares (via `targetInputId`) which dynamic input it feeds; on each solve Grasshopper computes a `name → value` option set, which is routed back into that input so the next solve can use the freshly-computed values.

New schema types: `DynamicValueListWidgetConfig` (with `defaultOptions`, `emptyBehavior`, `displayAs`), `DynamicValueListOutputConfig` (`targetInputId`), `InputDynamicValueListLayoutItem`, `OutputDynamicValueListLayoutItem`, and `"dynamicValueList"` added to `GrasshopperParamType` and the output type enums. Purely additive — existing schemas load unchanged via the C# `SchemaMigrator` (`MigrateTo_2_10_0`). Regenerated the TypeScript and C# (`UISchema.Generated.cs`) types.
