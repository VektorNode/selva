# Drawing system: outstanding work

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

### 1. Surface stroke-suppression input

`GH_CreateSurface` defaults to a black fill with no stroke unless a `Style` is connected; the
default fill can't be kept while explicitly suppressing the stroke without wiring a full
`PathStyle` and zeroing its width. Consider either:

- A dedicated `"No Stroke"` boolean input on `GH_CreateSurface`, OR
- Treat `Stroke.Width <= 0` as "no stroke" in the renderer so users can express it via `Path Style`.

### 2. Empty-document warning on `GH_RenderSvg`

`GH_RenderSvg.SolveInstance` returns silently when the input list is empty
(`GH_RenderSvg.cs` line 70). Surface a `GH_RuntimeMessageLevel.Warning` ("nothing to render")
so a user with a dead upstream branch sees the cause rather than just an absent output.

### 3. User-facing group component

`GroupElement` exists in the model (`Selva.Drawing/Model/Elements/GroupElement.cs`) and the
renderers handle it, but no GH component lets a designer explicitly group elements with an id
and transform. Useful for CSS-targeted SVG output and logical organization in downstream tools.

### 4. Hole-topology validation in `GH_CreateSurface`

If a Brep's inner edges escape the outer boundary (degenerate geometry), the renderer happily
produces a path with overlapping subpaths and the fill-rule result is undefined. A
bounds-containment check before assembling the Path would emit a clear warning instead of
silently broken output.

---

## Already shipped (was on the original review's wish list)

For reference, these are done: don't re-implement.

- **Angular dimension** → `GH_AngularDimension`
- **Text label** → `GH_CreateText` (with `GH_TextStyle`)
- **Dash pattern, separate cap/join, fill rule** → `GH_PathStyle` (`DP`, `LC`, `LJ`, `FR` inputs)
- **Background color** → `GH_RenderSvg` `Background` (`BG`) input
- **RGBA emission** → `SvgRenderer` emits `rgba(…)` when `color.A < 1`, `rgb(…)` otherwise

## Deliberately out of scope

Gradients, filters, blur/shadow effects, SMIL animation. Technical drawing tool, not a general
SVG editor.
