# SVG System Review

## Pipeline Overview

```
GH_CreateSvgCurve  ─┐
GH_CreateSvgSurface ┼─► GH_CombineToSvg ──► SVG string ──► GH_ExportSvgFile
GH_LinearDimension ─┘
        │
    GH_PathStyle (style input for curve/surface)
```

Rhino geometry flows into typed data classes (`SvgCurveData`, `SvgSurfaceData`, `SvgDimensionData`), assembled by `GH_CombineToSvg` into a complete SVG document via `SvgWriter`. Coordinate system: single root Y-flip transform `matrix(1 0 0 -1 0 0)` converts Rhino world-space to SVG screen-space. Dimension text applies a counter-rotation (`scale(1,-1)`) to stay upright.

---

## Bugs

### `GH_CurveInfo` — "Can Fill" duplicates "Is Closed"

**File:** `Components/GH_CurveInfo.cs`

The "Can Fill" output emits `curve.IsClosed` — same as "Is Closed". It should test whether the curve is a valid fill boundary (e.g. `curve.IsClosed || curve.IsPeriodic`).

---

## High-Value Missing Features

### 1. Dash pattern input on `GH_PathStyle`

`PathStyleData.DashArray` exists but is never exposed as a component input. Dotted lines, centerlines, and hidden lines are essential in technical drawings.

**Proposed input:** `"Dash Pattern" (DP)` — list of numbers, e.g. `[5, 2, 1, 2]`

Maps directly to SVG `stroke-dasharray`.

---

### 2. Angular dimension component (`GH_AngularDimension`)

`GH_LinearDimension` covers linear measurements. Angular dimensions (arc-segment dimension line + angle label) are equally common in technical drawings and are completely absent.

**Inputs needed:** two reference lines or three points, offset, text size, color.

---

### 3. Text label component (`GH_CreateSvgText`)

No way to place arbitrary text. Needed for callouts, part numbers, annotations, and title blocks.

**Inputs needed:** text string, position (`Point3d`), size, color, horizontal anchor (left/center/right), rotation angle.

---

### 4. Fill rule control in `GH_PathStyle`

`fill-rule` is hardcoded to `evenodd` in `GH_CreateSvgSurface`. For self-intersecting paths this produces incorrect results with nonzero winding.

**Proposed input:** `"Fill Rule" (FR)` — boolean or enum: evenodd / nonzero.

---

### 5. Optional style input on `GH_CreateSvgSurface`

Surfaces currently fall back to a hardcoded light-gray fill + black 1px stroke when no style is provided. There is no way to suppress the stroke or adjust defaults without wiring a full `PathStyle`.

The style input should already be optional (null = use defaults), which it is — but the defaults should at minimum be documented, and a stroke-suppression path should exist.

---

## Medium Priority

### 6. Expose curve approximation tolerance

`CurveConverter` hardcodes `chordTol = 0.01` for Bezier approximation. For large-scale models (meters) this is fine; for small-scale (sub-mm) or high-precision output it can introduce visible error.

**Proposed:** optional `"Tolerance" (T)` input on `GH_CreateSvgCurve`, defaulting to `0.01`.

---

### 7. Empty-bounds warning in `GH_CombineToSvg`

When no geometry is connected, the component silently returns a near-empty SVG. It should emit a `GH_RuntimeMessageLevel.Warning` so users know nothing was assembled.

---

### 8. Separate cap and join controls in `GH_PathStyle`

`"Round Caps" (R)` is a single boolean that sets both `stroke-linecap` and `stroke-linejoin` to Round simultaneously. Explicit separate controls would be more useful:

- `"Line Cap" (LC)` — butt / round / square
- `"Line Join" (LJ)` — miter / round / bevel

The current combined boolean can stay as a convenience default if desired.

---

### 9. Background color input on `GH_CombineToSvg`

The assembled SVG always has a transparent background. A `"Background" (BG)` color input would add a `<rect width="100%" height="100%" fill="..."/>` as the first child element.

---

## Nice to Have

### `GH_SvgGroup` component

Wraps a list of curves/surfaces/dimensions into a `<g id="..." class="...">` element. Enables CSS targeting, logical grouping, and selective hiding in downstream tools.

---

### RGBA support in `SvgWriter.Rgb()`

`SvgWriter.Rgb()` ignores the alpha channel of `System.Drawing.Color` and always emits `rgb(r,g,b)`. When a color has alpha < 255, it should emit `rgba(r,g,b,a)` or fold the alpha into the relevant opacity attribute.

---

### Hole topology validation in `GH_CreateSvgSurface`

If a Brep's "inner" edges are actually outside the outer boundary (degenerate geometry), the component silently emits broken SVG. A bounds-containment check before output would catch this early.

---

## What to Skip

Gradients, filters, blur/shadow effects, and SMIL animation are out of scope for a technical drawing tool. The current focus on clean, scalable, standards-compliant output is correct. Don't add these.

---

## File Map

| File | Role |
|---|---|
| `Components/GH_CreateSvgCurve.cs` | Curve → `SvgCurveData` |
| `Components/GH_CreateSvgSurface.cs` | Brep → `SvgSurfaceData` (with holes) |
| `Components/GH_PathStyle.cs` | Stroke/fill style → `PathStyleData` |
| `Components/GH_LinearDimension.cs` | 2-point dimension → `SvgDimensionData` |
| `Components/GH_CombineToSvg.cs` | Assembles complete SVG document |
| `Components/GH_ExportSvgFile.cs` | Writes SVG string to disk |
| `Components/GH_CurveInfo.cs` | Debug info about a curve (has bug) |
| `Lib/CurveConverter.cs` | Rhino curve → SVG path data (`M L A C Z`) |
| `Lib/PathStyleData.cs` | Data class: stroke, fill, dash, caps |
| `Lib/SvgCurveData.cs` | Data class: path data + style + metadata |
| `Lib/SvgDimensionData.cs` | Data class: pre-rendered dimension SVG fragment |
| `Lib/SvgWriter.cs` | SVG attribute helpers, XML escaping |
| `Lib/SurfaceHelper.cs` | Brep edge extraction utilities |
