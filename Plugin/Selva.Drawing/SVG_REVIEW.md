# Drawing system — outstanding work

> Predecessor of this file ("SVG System Review") inventoried the pre-refactor SVG-string pipeline.
> That pipeline has been replaced by the format-agnostic Document Model in `Selva.Drawing/` plus
> the renderer pair in `Rendering/Svg/` and `Rendering/Pdf/`. Most of the original findings landed
> with the rewrite; what remains is captured below.

Current pipeline:

```
GH_CreateCurve  ─┐
GH_CreateSurface ┤
GH_CreateText    ┤
GH_LinearDimension ┼─► DrawElements ──► (DrawingView ──► Page) ──► Document ──► SvgRenderer / PdfRenderer
GH_AngularDimension ┤
…                ─┘
                   ▲
            GH_PathStyle (style input for path/surface)
            GH_TextStyle (style input for text)
```

GH components live in `Plugin/Selva.GH/Features/Drawing/`. Pure model + renderers live in `Plugin/Selva.Drawing/`.

---

## Outstanding

### 1. Surface stroke-suppression path

`GH_CreateSurface` falls back to light-gray fill + black 1px stroke when no `Style` is connected
(`GH_CreateSurface.cs` ~lines 102–111). There is no way to keep the fill default and suppress the
stroke — you have to wire a full `PathStyle` and zero the stroke width. Consider either:

- A dedicated `"No Stroke"` boolean input on `GH_CreateSurface`, OR
- Treat `Stroke.Width <= 0` as "no stroke" in the renderer so users can express it via `Path Style`.

### 2. Expose curve approximation tolerance on `GH_CreateCurve`

`CurveConverter.ToPath(curve, chordTol, kinkTol)` accepts a tolerance, but `GH_CreateCurve`
hardcodes `0.01` locally (`GH_CreateCurve.cs:61`). Same in `GH_CreateSurface.cs:70`. For
sub-mm models or high-precision output, this is too coarse. Add an optional `"Tolerance" (T)`
input on both components, defaulting to `0.01`.

### 3. Empty-document warning on `GH_RenderSvg`

`GH_RenderSvg.SolveInstance` returns silently when the input list is empty (line 71). Surface
a `GH_RuntimeMessageLevel.Warning` ("nothing to render") so a user with a dead upstream branch
sees the cause rather than just an absent output.

### 4. User-facing group component

`GroupElement` exists in the model (`Selva.Drawing/Model/Elements/GroupElement.cs`) and the
renderers handle it, but no GH component lets a designer explicitly group elements with an id
and transform. Useful for CSS-targeted SVG output and logical organization in downstream tools.

### 5. Hole-topology validation in `GH_CreateSurface`

If a Brep's inner edges escape the outer boundary (degenerate geometry), the renderer happily
produces a path with overlapping subpaths and the fill-rule result is undefined. A
bounds-containment check before assembling the Path would emit a clear warning instead of
silently broken output.

---

## Already shipped (was on the original review's wish list)

For reference — these are done, don't re-implement:

- **Angular dimension** → `GH_AngularDimension`
- **Text label** → `GH_CreateText` (with `GH_TextStyle`)
- **Dash pattern, separate cap/join, fill rule** → `GH_PathStyle` (`DP`, `LC`, `LJ`, `FR` inputs)
- **Background color** → `GH_RenderSvg` `Background` (`BG`) input
- **RGBA emission** → `SvgRenderer` emits `rgba(…)` when `color.A < 1`, `rgb(…)` otherwise

## Deliberately out of scope

Gradients, filters, blur/shadow effects, SMIL animation. Technical drawing tool, not a general
SVG editor.
