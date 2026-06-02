---
'@selvajs/schemas': minor
'@selvajs/ui': minor
---

Add shared schema layout-traversal helpers.

**New — `getGroups` / `getLayoutItems` / `getInputItems`** in `@selvajs/schemas`
(`src/traversal.ts`). One place that knows how to walk a `UISchema`'s `tabbed`/`flat`
layout union, replacing the hand-rolled `layout.type === 'tabbed' ? tabs.flatMap(...) :
groups` branch that was duplicated across both packages. Readers are defensive — a
missing layout or empty groups/items yields an empty result rather than throwing.
`@selvajs/ui` re-exports all three so existing consumers are unaffected.

Internally collapsed onto these: `getExternalInputs`, the preset exporter's group walk,
and (in plugin-ui) `getAllLayoutItems`, `isItemUsedInLayout`, `batchSetNumberWidgetType`.
