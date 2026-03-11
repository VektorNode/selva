---
"@selva/schemas": minor
"@selva/shared": minor
"@selva/builder-app": patch
---

Add color widget support and `inputStructure` field to schema (v2.3.0)

**Schema additions (v2.2.0 → v2.3.0):**
- Added `"color"` variant to `GrasshopperParamType` enum for Grasshopper `Param_Colour` parameters
- Added `ColorWidgetConfig` type (reserved for future options)
- Added `InputColorLayoutItem` — new layout item with `widgetType: "color"` for a native browser color picker
- Added `GrasshopperInputStructure` enum (`"item"` | `"list"` | `"tree"`) mirroring Grasshopper data access modes
- Added `SchemaInput.inputStructure` (optional, defaults to `"item"`) — declares the intended data access mode for the parameter
- Updated `isInputLayoutItem` type guard and `InputLayoutItem` alias to include `InputColorLayoutItem`
- Added `isColorWidget` type guard

**Shared UI:**
- Added `ColorInput.svelte` — a native `<input type="color">` component with hex value display
- Updated `InputControl.svelte` to render `ColorInput` for color widget items

**Builder app:**
- Updated `widget-config.ts` to map `"color"` param type to color widget and generate default `ColorWidgetConfig`

Both schema changes are fully backward-compatible. Existing schemas without `inputStructure` or color widgets load without modification.
