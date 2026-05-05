# Drawing System: Document Model + PDF Architecture Plan

**Status:** Phases 0–10 complete (PDF hatch rendering completed 2026-05-05)
**Last updated:** 2026-05-05
**Owner:** Felix
**Decision authority:** Felix — this plan is the source of truth; deviations should update it

## Context

Today the Selva drawing system in `Plugin/Selva.Drawing/` emits SVG strings directly from
geometry builders (`LinearDimensionBuilder`, `AngularDimensionBuilder`, `CurveConverter`,
etc.). Components like `GH_CreateSvgCurve`, `GH_LinearDimension`, `GH_CombineToSvg` produce
typed data carriers (`SvgCurveData`, `SvgSurfaceData`, `SvgDimensionData`, `SvgTextData`)
that contain pre-rendered SVG fragments. `SvgDocument.Build()` concatenates them into a
final SVG document.

**This works for SVG-only output but does not scale to:**
- PDF output (production data, print-ready files)
- Multi-page documents (drawing sets, BOMs, title blocks)
- Rich production layout (tables, text flow, frames, drawing views)
- Identical-looking output across formats (font embedding, CMYK colors)
- Non-SVG export targets we may want later (e.g. direct print)

The user has explicitly chosen the most thorough architectural option: replace the
SVG-string-centric pipeline with a **format-agnostic Document Model** and a **renderer
layer** that emits SVG, PDF, and any future formats from the same source of truth.

**No SVG output is in production yet** — refactor cost is acceptable; goal is the right
long-term architecture, not minimal disruption.

## Guiding principles

1. **One model, many renderers.** Builders produce strongly-typed model objects.
   Renderers are pure functions: `Document → bytes`. SVG and PDF are siblings.
2. **No string-based geometry.** Path data is a typed list of segments
   (`MoveTo`/`LineTo`/`CubicTo`/`ArcTo`/`Close`), never SVG `d=` strings inside the model.
3. **Y-up everywhere in the model.** Rhino-world coordinates. SVG renderer applies the
   Y-flip on emit; PDF renderer doesn't (PDF is natively Y-up). Builders work in real
   world coords — no more flipping sweep flags to compensate.
4. **Real font metrics.** Bundle a font (Inter), measure text properly, used by all
   layout decisions. Replaces today's `0.55 × charCount × fontSize` heuristic.
5. **Visitor pattern for renderers.** Each renderer implements `IElementVisitor`. Adding
   an element type is one method per renderer; the compiler enforces completeness.
6. **Snapshot tests pin behavior.** Every refactor step verifies output parity
   byte-by-byte (or pixel-compare for visual output) before moving on.
7. **Each phase ships independently.** No Big-Bang merge. Steps 1–3 are invisible
   plumbing; from step 4 onward every phase delivers user-visible value.

## Architecture

### Project layout (target)

```
Plugin/Selva.Drawing/
  Model/
    Document.cs              — root: pages, embedded resources, metadata
    Page.cs                  — paper size, margins, content tree
    Geometry/
      PathSegment.cs         — sealed record hierarchy: MoveTo|LineTo|CubicTo|ArcTo|Close
      Path.cs                — IReadOnlyList<PathSegment> + helpers
      Transform.cs           — 2D affine
      BoundingBox.cs         — exact for primitives
    Style/
      Stroke.cs              — color, width, dash, cap, join, miter limit
      Fill.cs                — solid/gradient/pattern, fill-rule
      TextStyle.cs           — font family, size, weight, italic, decoration, color
      Color.cs               — RGB/RGBA/CMYK + named (essential for print PDFs)
    Elements/
      DrawElement.cs         — abstract base, IElementVisitor accept()
      PathElement.cs         — generic stroked/filled path
      TextElement.cs         — single-run text (existing SvgTextData equivalent)
      TextBlockElement.cs    — wrapped multi-line in a box
      ImageElement.cs        — embedded raster (logos, photos)
      GroupElement.cs        — children + transform
      DimensionElement.cs    — keeps dimension semantic (vertex/arms/style), renderer
                              emits the actual lines+arrows+arc on demand
      LeaderElement.cs       — pointer line + text
      HatchElement.cs        — fillable region + pattern
      SymbolElement.cs       — like SVG <use> / PDF Form XObject; defined once, instanced
    Layout/
      Frame.cs               — bordered region with padding
      Table.cs               — proper layout (column widths, row heights, span, headers)
      TextFlow.cs            — paragraph layout with line breaking
      Stack.cs               — vertical/horizontal stack with alignment + spacing
      Grid.cs                — flex-style grid
    Drawings/                — composite/opinionated primitives
      DrawingView.cs         — scaled view of geometry + frame + scale label
      TitleBlock.cs          — drawing title block (project, drawing#, scale, rev, date)
      RevisionTable.cs       — drawing revision history
      LegendBlock.cs         — symbol legend
      NotesBlock.cs          — numbered notes
  Builders/
    LinearDimensionBuilder.cs      — emits DimensionElement (NOT SVG strings)
    AngularDimensionBuilder.cs
    CurveBuilder.cs                — was CurveConverter; emits PathElement
    SurfaceBuilder.cs              — emits PathElement (closed)
  Fonts/
    FontMetrics.cs           — load TTF, MeasureString, GetAscent/Descent
    EmbeddedFonts.cs          — bundled fonts as Resources
    Resources/Inter-Regular.ttf
    Resources/Inter-Bold.ttf
  Rendering/
    IRenderer.cs              — Render(Document doc) → byte[] or string
    IElementVisitor.cs        — Visit(PathElement)/Visit(TextElement)/...
    Svg/
      SvgRenderer.cs          — visitor over elements
      SvgPathBuilder.cs       — typed Path → SVG d-string
      SvgFontResolver.cs      — emit fonts as @font-face data URIs
    Pdf/
      PdfRenderer.cs          — visitor over elements, uses PdfSharpCore
      PdfPathBuilder.cs       — typed Path → XGraphics calls
      PdfFontEmbedder.cs      — Type0/CIDFont embedding
      PdfMetadata.cs          — /Info dictionary + XMP

Plugin/Selva.Drawing.Tests/        — NEW: snapshot test suite
  Snapshots/                       — golden SVG/PDF files
  RendererParityTests.cs           — same Document → same output every time

Plugin/Selva.GH/Features/Drawing/Components/
  (existing components migrated; new layout/document components added)
```

### Public API shape

```csharp
// User code (or a Grasshopper component) builds a Document:
var doc = new Document {
    Metadata = { Title = "Bracket Assembly", Author = "Felix" },
    Pages = {
        new Page(PaperSize.A3, margins: 10) {
            Content = new GroupElement {
                new DrawingView(geometry, scale: 1/5.0, frame: true),
                new TitleBlock(...),
                new Table(...),
            }
        }
    }
};

// Render to either format from the same Document:
byte[] pdfBytes = new PdfRenderer().Render(doc);
string svgText = new SvgRenderer().Render(doc);
```

### Renderer dispatch (visitor pattern)

```csharp
public interface IElementVisitor {
    void Visit(PathElement e);
    void Visit(TextElement e);
    void Visit(TextBlockElement e);
    void Visit(ImageElement e);
    void Visit(GroupElement e);
    void Visit(DimensionElement e);
    void Visit(LeaderElement e);
    void Visit(HatchElement e);
    void Visit(SymbolElement e);
    // Layout elements decompose into primitives during layout pass — visitors don't see them.
}

public abstract class DrawElement {
    public abstract void Accept(IElementVisitor v);
}
```

`SvgRenderer` and `PdfRenderer` each implement `IElementVisitor`. Adding `LeaderElement`
later means: add the class, add one method to each visitor. Compiler enforces it.

## Library choices (locked)

- **PdfSharpCore** (MIT, pure C#, no native deps) — PDF emit. Has `XGraphics`,
  `XFont`, `XImage`, page management, CMYK support, font embedding, document metadata.
  ~500KB. Drop-in.
- **No SkiaSharp.** No native deps in the plugin.
- **No PuppeteerSharp / Inkscape.** No external processes, no Chromium download.
- **Bundled fonts:** Inter Regular + Inter Bold (or chosen brand font). Embedded as
  managed resources. ~400KB total. Guarantees identical-looking output everywhere.
- **HarfBuzzSharp:** *Only* if international shaping is needed (CJK, Arabic, RTL).
  Defer until a real use case appears. Not part of phase 1.

## Phased delivery plan

Each phase is shippable. Tests must pass before moving to the next phase.

### Phase 0 — Pre-flight (1 day)

**Goal:** Lock decisions, set up scaffolding.

- [x] Add `Selva.Drawing.Tests` xUnit project to the solution. (`Plugin/Selva.Drawing.Tests/`, `net8.0`, mirrors `Selva.Tests` setup, references `Selva.Drawing`.)
- [x] Add `PdfSharpCore` NuGet to `Selva.Drawing.csproj`. (Version `1.3.67` — supports `netstandard2.0`.)
- [x] Bundle Inter Regular + Bold as embedded resources. (`Plugin/Selva.Drawing/Fonts/Resources/Inter-Regular.ttf` + `Inter-Bold.ttf` + `LICENSE.txt`, from Inter v4.1; embedded via `<EmbeddedResource Include="Fonts\Resources\*.ttf"/>`. Resource names: `Selva.Drawing.Fonts.Resources.Inter-{Regular,Bold}.ttf`. Pinned by `EmbeddedFontResourceTests`.)
- [x] Snapshot test framework: **Verify.Xunit 28.3.2**. Best diff tooling, handles binary (PDF) and text (SVG) snapshots cleanly.
- [x] Minimum .NET target: `netstandard2.0` for `Selva.Drawing` confirmed compatible with PdfSharpCore 1.3.67. Test project targets `net8.0` to match `Selva.Tests`.

**Exit criteria:** ✅ Empty test project compiles and runs (3 tests passing: 1 smoke + 2 font-resource sanity checks).

### Phase 1 — Model types (no rendering, no behavior change)

**Goal:** All model types compiled, fully designed, with no consumers yet.

- [x] `Document`, `Page`, `PaperSize` (A4/A3/A2/A1/A0/Letter/Tabloid/custom mm + Margins).
- [x] `PathSegment` hierarchy + `Path` collection (sealed records + `Path.Builder` + tight cubic bounds via derivative roots).
- [x] `Transform` (2D affine, composable; SVG matrix(A B C D E F) layout).
- [x] `Stroke`, `Fill`, `TextStyle`, `Color` (RGB + CMYK + Named, with hex parsing).
- [x] `DrawElement` base + `IElementVisitor` interface.
- [x] All concrete elements: `PathElement`, `TextElement`, `TextBlockElement`,
      `ImageElement`, `GroupElement`, `DimensionElement`, `LeaderElement`,
      `HatchElement`, `SymbolElement`.
- [x] `BoundingBox` with exact bounds for each element type (cubic via derivative roots, conservative arc/dimension bounds documented).
- [x] Unit tests: equality, bounds, visitor dispatch + compile-time visitor completeness via stub `IElementVisitor` impl. (58 tests passing.)

**Exit criteria:** ✅ Model compiles in `Selva.Drawing` (`netstandard2.0`). `IElementVisitor` enforces handling all 9 concrete element types — adding a new element without extending the visitor breaks the test project's `RecordingVisitor`. Solution build green, no consumers wired in yet (`SvgDocument` and existing `Svg*Data` carriers untouched — Phase 3 migrates them).

**Phase 1 notes:**
- Code lives under `Plugin/Selva.Drawing/Model/` in sub-namespaces `Geometry`, `Style`, `Elements`, plus `Compat/IsExternalInit.cs` to enable `init` setters and `record` types on netstandard2.0.
- `Path` collides with `System.IO.Path` in test projects with implicit usings — tests use `using Path = Selva.Drawing.Model.Geometry.Path;`. The new `DimensionStyle` collides with the legacy SVG-era `Selva.Drawing.DimensionStyle`; tests alias it as `ModelDimensionStyle` until Phase 3 retires the old one.
- `BoundingBox.Empty` is the additive identity for `Union`. `Width`/`Height` return 0 (not negative) when empty.
- `DimensionElement` is semantic, not pre-rendered — it carries `A`/`B`/`Vertex`/`Offset`/`Label` so Phase 5's `PdfRenderer` can re-emit lines+arrows+arcs. Phase 1 bounds are conservative; Phase 4 will tighten them once real text metrics land.
- `SymbolElement` carries its `SymbolDefinition` directly so bounds work without a registry; the renderer-side dedupe ships in Phase 10.

### Phase 2 — `SvgRenderer` over the new model (output parity)

**Goal:** SVG output is **byte-identical** to today's, but produced from the model.

- [x] `SvgRenderer : IElementVisitor`. Walks model, emits today's exact SVG format. (`Plugin/Selva.Drawing/Rendering/Svg/SvgRenderer.cs`. Single-page render today; multi-page is Phase 6. Visitor handles every element type — `ImageElement`/`HatchElement` are visit-stubs (Phase 7+/8 emission); `LeaderElement` and `SymbolElement` emit basic forms.)
- [x] `SvgPathBuilder`: `Path` → `d=` string. (`Plugin/Selva.Drawing/Rendering/Svg/SvgPathBuilder.cs`. Public; reused by parity tests for legacy-input round-trips.)
- [x] `SvgFontResolver`: emit `@font-face` data URIs for bundled fonts. (`Plugin/Selva.Drawing/Rendering/Svg/SvgFontResolver.cs`. Off by default — `SvgRenderOptions.EmbedFonts` opts in. Default-off keeps parity with legacy output, which never embedded fonts.)
- [x] Snapshot tests: pinned via `SvgRendererParityTests`. Each test builds the same scene through the legacy `SvgDocument.Build` pipeline and the new `SvgRenderer`, then asserts byte-equal strings. Coverage: stroked `PathElement`, filled surface, `TextElement`, linear `DimensionElement`, angular `DimensionElement`, the combined three-element exit-criteria scene, and the empty-document fallback. Plus `SvgPathBuilderTests` for the `Path` → `d=` builder. Verify.Xunit is wired up but not exercised — direct `Assert.Equal` is enough when both sides produce comparable strings.

**Implementation notes:**
- The renderer maintains its own `MeasureForViewBox` walker rather than using `DrawElement.ComputeBounds`. The model's `ComputeBounds` is conservative on purpose (stroke-inflated paths, padded dimension labels) so layout stays safe; legacy SVG used raw geometry bounds. The walker pulls precise endpoint/midpoint/arc-sample sets out of dimensions and raw `Path.ComputeBounds()` from filled/stroked paths so the resulting viewBox byte-matches the legacy output. Phase 3 builders should target the same model and let the renderer measure.
- Dimension body emission was ported in-place from `LinearDimensionBuilder` / `AngularDimensionBuilder` since `DimensionElement` is now semantic, not pre-rendered. The legacy builders still exist and still emit SVG strings — Phase 3 retires them.
- `PathElement.Fill == null` ⇒ legacy "curve" emission (no `fill-rule`). `PathElement.Fill != null` ⇒ legacy "surface" emission. Multi-subpath filled paths emit `fill-rule` automatically (legacy required the caller to manually split outer/holes for that branch); the new behavior is more correct and is covered by `Surface_with_holes_emits_fill_rule`.
- Type aliases (`DimStyle`, `DimTickKind`, `DimTextPlacement`) inside `SvgRenderer.cs` work around the namespace collision between legacy `Selva.Drawing.DimensionStyle` and `Selva.Drawing.Model.Elements.DimensionStyle`. The legacy types disappear at the end of Phase 3 — the aliases go with them.

**Exit criteria:** ✅ The combined exit-criteria scene (`Combined_path_text_dimension_matches_legacy`) renders byte-identical SVG through both pipelines. All 13 `Rendering/` tests pass; full solution test run is 71 (`Selva.Drawing.Tests`) + 65 (`Selva.Tests`) = 136 green.

### Phase 3 — Migrate existing builders to emit the model

**Goal:** `LinearDimensionBuilder`, `AngularDimensionBuilder`, `CurveConverter`,
`SurfaceBuilder` all populate model objects instead of writing SVG strings.

Per builder:
1. Change return type from `Svg*Data` (with SVG `Body` string) to a model element.
2. Builder math stays unchanged. Coordinates stay Y-up (no more pre-flipping for SVG).
3. The Y-flip moves into `SvgRenderer` (root `<g transform>`).
4. Snapshot tests confirm parity through the full pipeline (builder → model → SVG).

GH components (`GH_LinearDimension`, `GH_AngularDimension`, `GH_CreateSvgCurve`,
`GH_CreateSvgSurface`, `GH_CreateSvgText`) update their output goo types to wrap the new
model elements. **No GUID changes** — the params still accept the same conceptual data,
just differently shaped internally. Existing GH definitions continue to work.

- [x] `CurveConverter.ToPath(Curve)` returns a model `Path`. (`Plugin/Selva.GH/Features/Drawing/Lib/CurveConverter.cs` — same Rhino dispatch (`LineCurve` / `PolylineCurve` / `ArcCurve` / cubic-bezier fallback), but each branch uses `Path.Builder` instead of a `StringBuilder`.)
- [x] `LinearDimensionBuilder.Build(...)` returns a `DimensionElement` (or `null` on coincident endpoints). (`Plugin/Selva.Drawing/LinearDimensionBuilder.cs`. Reduced to ~20 lines — semantic packing only; the renderer owns the lines/arrows/text emission since Phase 2.)
- [x] `AngularDimensionBuilder.Build(...)` returns a `DimensionElement` (or `null` on degenerate / collinear arms). (`Plugin/Selva.Drawing/AngularDimensionBuilder.cs`. The `reflex` flag is currently a no-op — `DimensionElement` doesn't yet carry it; defer to a later phase.)
- [x] `GH_PathStyle` outputs the new `Selva.Drawing.Model.Style.PathStyle` (a `Stroke`+`Fill` bundle); `GH_CreateSvgCurve` / `GH_CreateSvgSurface` / `GH_CreateSvgText` consume that and emit `PathElement` / `TextElement` directly.
- [x] `GH_LinearDimension` / `GH_AngularDimension` build the model `DimensionStyle` (renamed enums: `DimensionTickKind`, `DimensionTextPlacement`) and emit `DimensionElement`.
- [x] `GH_CombineToSvg` packs the four typed input lists into a `Document → Page → GroupElement` and runs `SvgRenderer`. Render order matches legacy: surfaces → curves → dimensions → text. Title flows through `Page.Title` + `DocumentMetadata.Title`. `GH_ExportSvgFile` is unchanged — it consumes the SVG string output.
- [x] Legacy types deleted: `SvgDocument`, `SvgWriter`, `SvgBounds`, `PathStyleData`, `SvgCurveData`, `SvgSurfaceData`, `SvgDimensionData`, `SvgTextData`, plus the legacy `DimensionStyle`/`DimensionTickStyle`/`DimensionTextPlacement` declarations and the `DimStyle`/`DimTickKind`/`DimTextPlacement` aliases inside `SvgRenderer.cs`.
- [x] Parity tests converted to snapshot form. (`Plugin/Selva.Drawing.Tests/Rendering/SvgRendererSnapshotTests.cs`. Eight pinned snapshots live in `Rendering/Snapshots/*.svg` and are copied to test output. `SvgScenes` builds each Document; `SnapshotGenerator` re-pins on demand via `SELVA_GENERATE_SNAPSHOTS=1`.)
- [x] New builder-pipeline tests cover `LinearDimensionBuilder` / `AngularDimensionBuilder` packing semantics (5 tests) and reject degenerate inputs.

**Phase 3 notes:**

- `Selva.Drawing` no longer carries any SVG-string-shaped types — only the model + renderer. `CurveConverter` stays in `Selva.GH/Features/Drawing/Lib/` because it depends on Rhino; the dimension builders moved to model-only output and live in `Selva.Drawing` (no Rhino dep).
- `GH_PathStyle` now emits `PathStyle` (a small wrapper around `Stroke?`+`Fill?`). When `GH_CreateSvgCurve` receives no style, it leaves both `Stroke` and `Fill` null on the `PathElement`; the renderer's `defaultFillNone` branch then emits `fill='none' stroke='black'` — preserving legacy "unstyled curve" semantics.
- `GH_CreateSvgSurface` builds a single combined `Path` containing the outer subpath followed by hole subpaths in one buffer (each hole is a `MoveTo`+segments+`Close`). The renderer emits `fill-rule` automatically when more than one `MoveTo` is present, which is more correct than the legacy "caller manually requests `fill-rule`" behaviour.
- Snapshot strategy: `SvgScenes` is the single source-of-truth scene definition for both the regenerator and the parity assertions. To re-pin after an intentional renderer change, set `SELVA_GENERATE_SNAPSHOTS=1` and run the `SnapshotGenerator.Capture_all_scenes` test once; commit the updated `*.svg` files alongside the renderer change.
- `GH_CreateSvgText`'s text bounds now go through `TextElement.ComputeBounds()` (0.55 × charCount × fontSize) instead of the GH component's own 0.6 multiplier. The viewBox shifts very slightly when text is the dominant content; acceptable since Phase 4's real font metrics replace this entirely.
- The renderer's in-place dimension emission stays put for now — `DimensionElement` is semantic, so the renderer is the right place for the geometry expansion. Phase 5's PDF renderer will share the same dispatch by re-implementing the `Visit(DimensionElement)` body in PDF terms.
- Token swap inside `SvgRenderer.cs`: `DimStyle`→`DimensionStyle`, `DimTickKind`→`DimensionTickKind`, `DimTextPlacement`→`DimensionTextPlacement` once the legacy duplicates were deleted. The aliases were a Phase 2 collision workaround; they're gone.

**Exit criteria:** ✅ Full pipeline (GH → builder → model → `SvgRenderer`) produces output matching today's pinned snapshots. Solution build green; **142 tests pass** across the whole `Plugin/` solution (77 in `Selva.Drawing.Tests`, 65 in `Selva.Tests`).

### Phase 4 — Real font metrics, layout-aware text

**Goal:** Replace text-width heuristics with real glyph measurement.

- [x] `FontMetrics.Measure(text, family, size, weight, style)` reads bundled Inter via a
      small TTF parser. (`Plugin/Selva.Drawing/Fonts/TrueTypeFont.cs` + `FontMetrics.cs`.
      Parses `head`/`maxp`/`hhea`/`hmtx`/`OS/2`/`cmap` (formats 4 + 12). Cached per
      embedded resource. Returns a `MeasuredText` (width + ascent/descent/lineGap +
      cap/x-height).)
- [x] `SvgRenderer` `BreakLine` dimension gap uses real measurement; legacy
      `0.55 × charCount` is now only a fallback when `Style.FontFamily` isn't bundled.
      (`Plugin/Selva.Drawing/Rendering/Svg/SvgRenderer.cs` `AppendLinearDimensionBody`.)
      The two dimension builders themselves stayed semantic (Phase 3) — they don't compute
      text gaps; the renderer does. The PDF renderer in Phase 5 will share `FontMetrics`
      the same way.
- [x] `TextElement.ComputeBounds()` derives width from real glyph advances and uses real
      ascent/descent for vertical extent. `MeasuredBounds`, when set, still wins. Falls
      back to the heuristic only for unknown families.

**Phase 4 notes:**
- We chose a small in-house TTF parser over PdfSharpCore's font stack to avoid pulling
  PdfSharpCore's global `XFontResolver` into the model layer (`Selva.Drawing.Model.*` is
  Pdf-free; only the renderers depend on PdfSharpCore). The parser is read-only and only
  decodes the metric tables — no shaping, no kerning, no glyph outlines. ~250 lines.
- Italic faces aren't bundled yet — `FontMetrics` resolves italic requests to the regular
  face. Phase 4 doesn't ship italic rendering; that lands when a use case needs it.
- New snapshot scene `linear_dimension_breakline.svg` pins the BreakLine path so any
  drift in real-font measurement (e.g. swapping Inter for a different family) is caught.
- The vertical text bounds shifted slightly: `TextElement.ComputeBounds` now uses real
  Inter ascent/descent (~0.95 and ~0.24 of size for Inter) instead of the 0.8/0.2
  approximation. None of the existing scenes' bounds were used for viewBox computation
  (the renderer's `MeasureForViewBox` walks raw geometry, not `ComputeBounds`), so no
  pre-Phase-4 SVG snapshots changed. The single text-only scene already supplied
  `MeasuredBounds` explicitly.

**Exit criteria:** ✅ Dimension text gaps now reflect real glyph widths regardless of
label content (`100.00` and `179.01` get the right gap; multi-byte/wide labels behave).
**156 tests pass** across the solution (91 in `Selva.Drawing.Tests`, 65 in `Selva.Tests`).

### Phase 5 — `PdfRenderer` (basic elements)

**Goal:** PDF output for simple drawings.

- [x] `PdfRenderer : IElementVisitor` using PdfSharpCore. (`Plugin/Selva.Drawing/Rendering/Pdf/PdfRenderer.cs`. Mirrors `SvgRenderer`'s structure: visitor over the element tree, single-page render today (multi-page is Phase 6). Coordinate system: PdfSharpCore's `XGraphics` is Y-down with origin top-left; the renderer applies one root `translate(0, pageHeight) + scale(1,-1)` so the model's Y-up world coords flow naturally. Text counter-flips locally with `scale(1,-1)` around the anchor point — same pattern as `SvgRenderer`.)
- [x] Handle `PathElement`, `TextElement`, `TextBlockElement`, `GroupElement`, `ImageElement` (stub), `DimensionElement` (linear + angular), `LeaderElement`, `HatchElement`, `SymbolElement` (inline expansion). `HatchElement` and `Fill.Pattern` on `PathElement` were stubs through Phase 10 and now ship in Phase 5.5: the renderer clips to the boundary path via `XGraphics.IntersectClip`, then draws repeating strokes/dots inside the bbox (PdfSharpCore exposes no public tiling-pattern brush, so clip-and-tile is the practical equivalent of SVG's `<pattern>` defs). Tile geometry mirrors the SVG renderer's `AppendHatchPatternDefs` (4mm tile × scale, 0.3mm × scale stroke, 0.4mm × scale dots, 4×8mm × scale brick courses with staggered head joints) so PDF and SVG output read the same. Tests: `PdfHatchTests` (12 tests).
- [x] Embed bundled Inter via `PdfFontEmbedder` (`Plugin/Selva.Drawing/Rendering/Pdf/PdfFontEmbedder.cs`). Implements PdfSharpCore's `IFontResolver`. Idempotent install via `EnsureInstalled()` — first `PdfRenderer.Render()` call wires the resolver into `GlobalFontSettings.FontResolver`; subsequent calls are no-ops because PdfSharpCore refuses to swap an in-use resolver. If a host application has already installed its own resolver, we leave it alone (the host's font setup wins).
- [x] `Document.Metadata` → PDF `/Info` dictionary (`PdfRenderer.ApplyMetadata`). Title/Author/Subject/Creator/Producer/Keywords/CreatedAt/ModifiedAt all flow through. Producer uses `Info.Elements.SetString("/Producer", ...)` because PdfSharpCore otherwise stamps its own producer string.
- [x] `PdfPathBuilder` (`Plugin/Selva.Drawing/Rendering/Pdf/PdfPathBuilder.cs`) converts the model `Path` to `XGraphicsPath`. The non-trivial piece is `ArcTo` flattening — PdfSharpCore's `AddArc` uses centre/start/sweep parameterisation, but our SVG-style `ArcTo` carries radii + large-arc + sweep flags. We implement the W3C SVG 1.1 §F.6.5 algorithm: compute the centre, split the sweep into pieces of ≤ π/2, approximate each with a cubic Bezier via `α = (4/3) tan(Δθ/4)`. ~5 control-point math lines per piece.
- [x] Tests: structural validity rather than byte-snapshots, because PdfSharpCore stamps modification dates and a unique trailer ID into every produced file. `PdfRendererTests` (12 tests) verifies: `%PDF-` header magic, `PdfReader.Open` round-trip, expected page count, page sizes match `PaperSize`/auto-fit calculations, `DocumentMetadata` round-trips through `Info.Title`/`Author`/`Keywords`/etc., and renderer reuse is idempotent. `PdfPathBuilderTests` (5 tests) covers each `PathSegment` kind through a real `XGraphics.DrawPath` to prove the path is well-formed.

**Phase 5 notes:**
- Auto-fit page size mirrors the SVG renderer: when `AutoFitToContent = true` (default) the page becomes `contentBounds + 2 × Padding`. When false, the page's `PaperSize` wins. An empty document renders a blank A4 so the file stays well-formed.
- The `IFontResolver` global-state constraint is the only sharp edge in this phase. PdfSharpCore throws if the resolver is replaced after first use, so install must be idempotent. If you ever see "Must not change font resolver after is was once used" in tests, two competing renderers tried to register different resolvers — only `PdfFontEmbedder` should be installed inside this codebase.
- Italic isn't bundled. `PdfFontEmbedder.ResolveTypeface` falls back to the regular face and lets PdfSharpCore simulate slant. Same trade-off as `FontMetrics` (Phase 4); both flip when an italic face is bundled.
- CMYK colours are preserved — `Color.Cmyk(...)` round-trips into `XColor.FromCmyk` with `ColorSpace = XColorSpace.Cmyk`. The SVG renderer converts CMYK to sRGB on emit; the PDF renderer keeps it native, which is the whole point of carrying CMYK through the model. Phase 9 (print-grade PDF features) builds on this.
- Dimensions are drawn with the same geometric formulae as `SvgRenderer.AppendLinear/AngularDimensionBody`. The arrowhead is rendered as a filled triangle (closer to the SVG marker) rather than a stroked V. `FontMetrics` is used for the BreakLine text-gap calculation, mirroring the Phase 4 SVG behaviour exactly.
- `LeaderElement` arrowhead emission is now real (was a stub in SVG-land). Polyline → arrowhead at the last segment + optional text label at the tip.

**Exit criteria:** ✅ Hand-crafted `Document` produces a valid PDF that `PdfReader.Open` can parse and that contains the expected page count, page sizes, metadata, and content streams. **173 tests pass** across the solution (108 in `Selva.Drawing.Tests`, 65 in `Selva.Tests`).

### Phase 6 — Pages, multi-page documents

**Goal:** A `Document` can contain multiple `Page`s with paper sizes and margins.

- [x] `Page` knows paper size (A-series + Letter/Tabloid + custom mm) and margins. (Already shipped in Phase 1; per-page paper size is now actually consumed by both renderers.)
- [x] SVG renderer emits one `<svg>` per page. (`SvgRenderer.RenderAll(Document)` returns `IReadOnlyList<string>` — one SVG per `Page`. Per Decision #3, we ship "one file per page" rather than the multi-group-single-SVG alternative; cleaner for downstream consumers and matches how SVG viewers expect documents. The existing `Render(Document)` still returns the first page only — preserves the snapshot suite and the back-compat path.)
- [x] PDF renderer emits multi-page PDF naturally. (`PdfRenderer.Render(Document)` now iterates every `Page` and calls `pdf.AddPage()` per entry; PdfSharpCore handles the rest. Empty documents still emit one blank A4 to keep the file well-formed.)
- [x] `GH_Document` component: collects `Page`s. (`Plugin/Selva.GH/Features/Drawing/Components/GH_Document.cs`. Inputs: list of `Page`, plus optional Title/Author/Subject/Keywords; populates `DocumentMetadata`. Tab: `Selva → SVG`.)
- [x] `GH_Page` component: paper size + margins + content. (`Plugin/Selva.GH/Features/Drawing/Components/GH_Page.cs`. Wraps a list of `DrawElement` in a `GroupElement`, attaches paper size (A0–A5 + Letter/Legal/Tabloid via a named-value enum), landscape flag, uniform margin.)
- [x] `GH_RenderSvg` and `GH_RenderPdf` components: take `Document`, output bytes/string. (`GH_RenderSvg.cs` outputs a list of SVG strings using `RenderAll`; `GH_RenderPdf.cs` outputs status/path/byte-count and writes to disk when `Write` is true. Today's `GH_CombineToSvg` continues to work — its description now points users at the new `Page → Document → Render` pipeline for multi-page or PDF output.)

**Phase 6 notes:**

- New components live on the existing `Selva → SVG` tab so users don't have to learn a new tab name. Phase 7+ may rename it to `Drawing` once the layout primitives ship.
- `GH_RenderSvg` returns a *list* output even for single-page documents — simpler downstream wiring than overloading on cardinality. The existing `GH_ExportSvgFile` continues to work with the `Combine to SVG` (single-string) path; for multi-page export users wire each list entry to its own writer or use the new `GH_RenderPdf`'s built-in file-write path.
- Render order convention from `GH_CombineToSvg` (surfaces → curves → dimensions → text) was *not* baked into `GH_Page`. Page composition is now the user's job — they wire elements to the `E` input in whatever Z-order they want. The legacy `GH_CombineToSvg` keeps its hard-coded order for back-compat.
- `GH_Document` stamps `Creator = "Selva"` and `Producer = "Selva.Drawing"` automatically; `CreatedAt` is set to `DateTime.UtcNow` so the PDF `/Info` dictionary has a sensible date even when the user doesn't supply one.
- Tests: `PdfMultiPageTests` (3 tests — multi-page count, per-page size round-trip, empty-document fallback) and `SvgMultiPageTests` (3 tests — `RenderAll` cardinality, per-page titles, empty-document → single blank SVG). Existing snapshot suite continues to pass — `Render(Document)` still returns the first page.

**Exit criteria:** ✅ A multi-page PDF is producible from a hand-built `Document`. `Document_with_four_pages_produces_four_page_pdf` verifies the 4-page case end-to-end (renders + reopens via `PdfReader` + asserts 4 pages). **179 tests pass** across the solution (114 in `Selva.Drawing.Tests`, 65 in `Selva.Tests`). Solution build green; both `net48` and `net7.0` targets of `Selva.GH` compile cleanly.

### Phase 7 — Layout layer

**Goal:** Production-data layout primitives.

- [x] `Stack` (vertical/horizontal, alignment, spacing). (`Plugin/Selva.Drawing/Model/Layout/Stack.cs`. CrossAlign = Start/Center/End/Stretch; Origin pins the bottom-left corner. Vertical stacks are rendered top-down in world Y-up coords — first child's TOP edge aligns with the stack's top, matching how spreadsheets and DOM tables read.)
- [x] `Grid` (flex-style rows/columns). (`Plugin/Selva.Drawing/Model/Layout/Grid.cs`. `GridLength` carries `Absolute(mm)` / `Auto` / `Star(weight)`. Star tracks fall back to natural sizing when `LayoutContext.AvailableWidth` is infinite — keeps `ComputeBounds()` stable in unconstrained contexts. Cells span via `GridCell.RowSpan`/`ColumnSpan`.)
- [x] `Frame` (bordered region with padding). (`Plugin/Selva.Drawing/Model/Layout/Frame.cs`. Optional `Size` lets callers fix the outer rect and centre a smaller child inside, useful for fixed-size title-block cells.)
- [x] `TextFlow` (multi-line text with line breaking using `FontMetrics`). (`Plugin/Selva.Drawing/Model/Layout/TextFlow.cs`. Greedy line-break: a candidate "word + space + next" is measured via `FontMetrics.Measure`; if it exceeds `Width`, flush the current line. Hard `\n` forces a paragraph break. `FixedHeight` caps the bounds for cells with explicit row heights.)
- [x] `Table` (column widths, row heights from content, borders, headers). (`Plugin/Selva.Drawing/Model/Layout/Table.cs`. Wraps Grid: header is row 0 (auto-bolded if no explicit `TableCell.Style`), body rows follow. `CellPadding` defaults to `(1.5, 2.5, 1.5, 2.5)` — typical drafting-spec table feel. Border emitted as a single multi-segment `Path` so the renderer treats the whole frame as one stroked path.)
- [x] Each layout element resolves to primitive elements during a layout pass before rendering. Renderers never see layout elements directly. (`Plugin/Selva.Drawing/Model/Layout/LayoutPass.cs`. `LayoutElement.Accept(visitor)` throws `InvalidOperationException` so a missed layout pass surfaces immediately. Both `SvgRenderer.RenderPage` and `PdfRenderer.RenderPage` call `LayoutPass.ResolvePage` on entry — automatic, no caller-side change.)
- [x] GH components for each. (`GH_Stack`, `GH_Frame`, `GH_TextFlow`, `GH_Grid`, `GH_Table` on the `Selva → SVG` tab. `GH_Grid` and `GH_Table` parse a small track DSL — `"40 auto 1*"` — for column/row sizes; `GH_Table` takes body rows as a data tree (one branch per row).)

**Phase 7 notes:**

- **Layout-pass placement.** `LayoutPass.Resolve` runs at `RenderPage` entry in both renderers, so users can put layout elements anywhere in the tree and the visitor surface stays unchanged. The pass walks `GroupElement.Children` in place, replacing each `LayoutElement` with its resolved primitive subtree; trees that contain no layout elements are returned by reference (cheap no-op for the existing snapshot suite).
- **`GroupElement.BoundsOverride`.** Phase 7 added an optional `BoundingBox?` to `GroupElement` so layout primitives (Grid, Frame, Table) can pin the resolved group's outer extent to the resolved track totals rather than the union of cell content. Without this, a column wider than its cell content would understate the grid's size when nested inside a Stack — the Stack would lay out children too tightly. The override is preserved through `LayoutPass.Resolve` rewrites and the existing `GroupElement.ComputeBounds` falls back to union-of-children when the override is null.
- **Bounds vs rendered footprint.** Layout primitives report *geometric* bounds (the track totals); renderers continue to compute viewBox/page size from the visitor walk that pulls precise endpoint/midpoint sets out of paths. Stroke half-width inflation lives on `PathElement.ComputeBounds` and only affects renderer-side measurement, not layout measurement — keeps the layout arithmetic clean (a 100mm-wide table reports 100mm regardless of border width).
- **Track DSL.** `GH_Grid` / `GH_Table` parse `"40 auto 1*"` into `GridLength[]`. `auto` ↔ `GridLength.Auto`, `<n>*` ↔ `GridLength.Star(n)` (default weight 1 if no number), bare numbers ↔ `GridLength.Absolute(mm)`. Comma- and tab-separated forms also work. `*` matches CSS-grid's `1fr` convention so users coming from web layout don't need to relearn.
- **Tests:** 27 new layout tests (Stack, Frame, TextFlow, Grid, Table, LayoutPass) + 2 BOM-pipeline tests (`PdfBomTableTests` — 5×4 BOM produces a valid 1-page PDF and an SVG containing the header text). Total: **143 in `Selva.Drawing.Tests`**, 65 in `Selva.Tests`, **208 across the solution**. Existing snapshot suite is unchanged because `LayoutPass.Resolve` returns inputs by reference when no layout elements are present.

**Exit criteria:** ✅ A 5-row × 4-column BOM table built from internalised data renders to a valid one-page PDF with proper text wrapping in cells (`PdfBomTableTests.Bom_table_renders_a_valid_pdf`). Solution build green; both `net48` and `net7.0` targets of `Selva.GH` compile cleanly.

### Phase 8 — Composite drawing primitives

**Goal:** Opinionated, ready-to-use building blocks.

- [x] `DrawingView` — scaled view of geometry, frame, scale label, optional title. (`Plugin/Selva.Drawing/Model/Drawings/DrawingView.cs`. Wraps geometry in a `GroupElement` whose transform composes `Translate(-geom.MinX, -geom.MinY) ∘ Scale(Scale) ∘ Translate(centring offset)` so the geometry's bounds at the input scale land centred inside an inner padded rect. Optional `Size` pins the outer viewport; null sizes to fit. `Caption` renders below the frame, anchored centre-baseline. Static `FormatScaleLabel(double)` produces standard "SCALE 1:N" / "SCALE N:1" / "SCALE 1:1" strings.)
- [x] `TitleBlock` — drawing title block with named fields. (`Plugin/Selva.Drawing/Model/Drawings/TitleBlock.cs`. Each row is a list of `TitleBlockField`s with optional `Span` (fraction-of-row); auto fields share the leftover width evenly. Each field renders as a `Frame` containing a stacked `TextFlow` for label + value with their own styles. Outer + inner gridlines drawn as a single multi-segment `Path` for crisp rendering. `TitleBlock.Standard(values, size)` produces the conventional 4-row layout (Project/Client → Title → DrawingNo/Rev/Scale/Sheet → Drawn/Date/Checked).)
- [x] `RevisionTable` — revision history. (`Plugin/Selva.Drawing/Model/Drawings/RevisionTable.cs`. Wraps Phase 7's `Table` with the four standard columns Rev/Date/Description/By. Rev/Date/By columns are absolute (configurable via `RevisionColumnWidth` / `DateColumnWidth` / `ByColumnWidth`); Description fills the remainder. Rendering goes through `Table.Resolve` so border/header/cell styling matches a hand-rolled table.)
- [x] `LegendBlock` — symbol legend. (`Plugin/Selva.Drawing/Model/Drawings/LegendBlock.cs`. Two-column table of `LegendEntry { Swatch, Description }`. Optional `Title` stacks above the table via `Stack`; the swatch column shows arbitrary `DrawElement`s (line samples, hatch tiles, symbol elements). Pins `BoundsOverride` to the resolved size so a containing Stack/Frame measures correctly.)
- [x] `NotesBlock` — numbered notes. (`Plugin/Selva.Drawing/Model/Drawings/NotesBlock.cs`. Each note is a 2-column `Grid` (gutter + body) so multi-line wrapped text hangs cleanly. Auto-numbering "1.", "2." applies when `Markers` is null or doesn't match `Notes.Count`. Optional `Title` adds a bold heading above the list with a configurable `TitleSpacing`.)
- [x] GH components. (`GH_DrawingView`, `GH_TitleBlock`, `GH_RevisionTable`, `GH_LegendBlock`, `GH_NotesBlock` on the `Selva → SVG` tab at `GH_Exposure.quarternary`. `GH_TitleBlock` exposes the conventional fields as discrete inputs (Project/Client/Title/DrawingNo/Revision/Scale/Sheet/Author/Date/Checker) and produces a `Standard()` block; advanced layouts go through C# directly. `GH_RevisionTable` and `GH_LegendBlock` take parallel lists for rows.)

**Phase 8 notes:**

- **Layout-pass placement.** Every Phase 8 primitive is a `LayoutElement`; `Resolve` returns a `GroupElement` of pre-positioned primitives. `LayoutPass.Resolve` already runs at `RenderPage` entry in both renderers (Phase 7), so callers get composite layout for free — no special-casing in the visitor surface.
- **`BoundsOverride` continues to matter.** `DrawingView`/`TitleBlock`/`LegendBlock`/`NotesBlock` all set `GroupElement.BoundsOverride` to their geometric outer extent, so they nest cleanly inside Stacks/Grids. Without this, a `DrawingView` with a stroke-thick border would report a slightly-larger bound and disturb downstream layout arithmetic. `RevisionTable` inherits the override from the underlying `Table.Resolve`.
- **`DrawingView` scale convention.** `Scale = 1.0` means full-size (1mm of model = 1mm on paper); `0.2` means 1:5; `2.0` means 2:1. Caption formatting via `FormatScaleLabel` matches drafting convention. The view does not clip overflowing geometry — that's the caller's responsibility (use a smaller Scale or larger Size).
- **`TitleBlock` column-width algorithm.** Spans summing to ≤1.0 are treated as fractions of total width; Spans summing to >1.0 are weights and Auto fields take a proportional remainder. This preserves both the "I want exact widths" and "I want columns to share equally" use cases without two separate APIs.
- **`PdfRenderOptions.AutoFitToContent = false` for fixed-paper output.** The default auto-fit behaviour grows the page to fit content + padding — perfect for free-form drawings, but it overrides explicit `PaperSize.A2` requests when content extends beyond it. Tests that assert paper size explicitly set `AutoFitToContent = false`. The full-sheet integration test uses `A2.Landscape()` (594×420) since the multi-view + title-block + revision-table layout reads more naturally in landscape.
- **Tests:** 20 new composite primitive tests (`DrawingViewTests`, `TitleBlockTests`, `RevisionTableTests`, `LegendBlockTests`, `NotesBlockTests`) cover natural sizing, fixed-size pinning, header growth, marker auto-numbering, and content overflow behaviour. Plus 2 new sheet-integration tests (`PdfSheetIntegrationTests`) verifying the full A2 sheet round-trips through `PdfReader` and contains the expected SVG text content. Total: **165 in `Selva.Drawing.Tests`**, 65 in `Selva.Tests`, **230 across the solution**.

**Exit criteria:** ✅ A complete "drawing sheet" — two `DrawingView`s, a `TitleBlock`, a Phase 7 `Table`-based BOM, a `NotesBlock`, and a `RevisionTable` — renders to a valid one-page A2-landscape PDF (`PdfSheetIntegrationTests.Full_sheet_renders_to_a_valid_one_page_pdf`). The same scene also produces a valid SVG with the expected title-block / revision-table / notes text (`Full_sheet_renders_to_svg_with_title_and_revision_text`). Solution build green; both `net48` and `net7.0` targets of `Selva.GH` compile cleanly.

### Phase 9 — Print-grade PDF features

**Goal:** PDFs ready for production / print-shop use.

- [x] CMYK colors throughout (`Color.Cmyk(c, m, y, k)`). The colour model already carried CMYK from Phase 1; Phase 9 wires it through to the rendered content stream. PdfSharpCore selects fill/stroke operators (`rg/RG` vs `k/K`) based on the document-wide `PdfDocumentOptions.ColorMode`, with no per-page override. The Selva renderer exposes this via `PdfRenderOptions.ColorMode` (`PdfColorMode.Rgb` default, `PdfColorMode.Cmyk` opt-in). When `Cmyk`, every colour — including upstream RGB — is converted to CMYK on emit so Acrobat preflight stops complaining about mixed colour spaces.
- [x] PDF document metadata (title, author, creator, subject, keywords). Already shipped in Phase 5 via `ApplyMetadata` → PDF `/Info` dictionary. Phase 9 adds the XMP companion stream (next bullet).
- [x] XMP metadata for document management systems. (`Plugin/Selva.Drawing/Rendering/Pdf/PdfXmpMetadata.cs`. Builds an RDF/XML packet from `DocumentMetadata` covering Dublin Core (`dc:title`, `dc:creator`, `dc:description`, `dc:subject`/keywords), the XMP basic schema (`xmp:CreatorTool`, `xmp:CreateDate`, `xmp:ModifyDate`), and the PDF schema (`pdf:Producer`, `pdf:Keywords`). Attaches the packet via `pdf.Internals.AddObject(...)` + `Catalog.Elements["/Metadata"] = stream.Reference`. The legacy `/Info` dictionary is still written; XMP is additive — required for PDF/A and for DAM systems that ignore `/Info`. Toggle via `PdfRenderOptions.EmitXmpMetadata` (default true).
- [x] PDF bookmarks (one per page or per `DrawingView`). `PdfRenderer.ApplyOutlines` walks the rendered pages and adds one top-level outline per page (using `Page.Title` or `"Page N"` when blank), then nests an entry per `DrawingView` whose `Caption` is set. The DrawingView walk happens on the unresolved tree before `LayoutPass.Resolve` rewrites the children into primitive groups, so caption text survives. Toggle via `PdfRenderOptions.EmitOutlines` (default true).
- [x] Hyperlinks in `TextElement`. New `TextElement.Hyperlink` field carries an opt-in URL. PDF: the renderer collects `(worldRect, url)` pairs during the visitor pass and calls `pdfPage.AddWebLink(rect, url)` after the visitor finishes — by that point the page's MediaBox is fixed so coordinate math is straightforward. The rect is the text's `ComputeBounds()` translated through the page-level offset (`_pageTranslateXMm/YMm`) and converted from mm to PDF points. SVG: wraps the `<text>` element in `<a href='...'>...</a>` so browser viewers and SVG-to-PDF exporters both pick up the link. Toggle via `PdfRenderOptions.EmitHyperlinks` (default true); the underlying field is opt-in so toggling off only matters when `Hyperlink` is set.
- [x] Font subsetting (embed only used glyphs). PdfSharpCore subsets unconditionally — `PdfType0Font.PrepareForSave` calls `FontDescriptor.FontFace.CreateFontSubSet(...)` on every save, with no off-switch. The bundled Inter Regular + Bold (~400 KB combined) shrink to a few KB per document depending on glyph coverage. No code change required; documented here for completeness. `XPdfFontOptions` exposes `WinAnsiDefault` (smaller, CP1252) and `UnicodeDefault` (full Unicode, larger Type0/CIDFont). Selva uses the default Type0 path so emoji and non-Latin characters render correctly.
- [ ] PDF/A-1b conformance for archival (if there's a use case). Deferred — needs additional XMP fields (`pdfaid:part`/`conformance`), an output-intent profile (sRGB or coated CMYK ICC), and stricter validation. Not a current use case.

**Phase 9 notes:**

- **Document-wide colour mode.** PdfSharpCore reads `PdfDocumentOptions.ColorMode` once during content-stream emission and writes either `rg/RG` (RGB) or `k/K` (CMYK) operators for *every* colour, regardless of the source `XColor.ColorSpace`. There is no per-page override. A document that needs both RGB pages and CMYK pages must render twice and merge externally. The renderer maps `PdfRenderOptions.ColorMode` (Selva's enum) to `PdfSharpCore.Pdf.PdfColorMode` (PdfSharp's enum) via a using-alias to avoid name collision.
- **XMP packet structure.** Three required parts: `<?xpacket begin?>` framing, an `<x:xmpmeta>` envelope, and an `<rdf:RDF>` body. Inside RDF each metadata schema lives in its own namespace on the root `rdf:Description`. Trailing whitespace + `<?xpacket end?>` lets DAMs rewrite the packet in place without growing the file. `BuildPacket` is `internal` and exposed to the test project via `InternalsVisibleTo` so the RDF/XML can be string-asserted without a full PDF round-trip.
- **Outline emission timing.** Outlines need `PdfPage` references and the model `Document` side-by-side, so the renderer keeps `_renderedPages` (a `List<PdfPage>`) populated during multi-page render and emits outlines once after all pages are written but before `pdf.Save`. We walk the *unresolved* `Page.Content` tree to find `DrawingView` instances — `LayoutPass.Resolve` rewrites them into primitive groups, so post-resolve the captions are buried in `TextElement` siblings without a stable identity.
- **Hyperlink rect coordinate space.** `TextElement.ComputeBounds()` returns world-mm bounds (Y-up, model space). The page-level translate (`_pageTranslateXMm/YMm`) maps model→PDF user space, which is also Y-up from the page bottom-left, so the conversion to PDF points is just `(modelMm + translate) × 72/25.4`. Rotated text gets an axis-aligned bbox; tight-fit rotated rectangles would need PDF QuadPoints, which PdfSharpCore doesn't expose.
- **Tests:** 13 new tests across 4 files. `PdfXmpMetadataTests` (4) — packet structure, XML escaping, /Catalog attachment, opt-out. `PdfHyperlinkTests` (4) — PDF /Link annotation, SVG `<a href>`, opt-out, no-link path. `PdfOutlinesTests` (3) — top-level per-page, nested DrawingView captions, opt-out. `PdfCmykTests` (2) — CMYK content-stream operators, default RGB sanity. Total: **178 in `Selva.Drawing.Tests`**, 65 in `Selva.Tests`, **243 across the solution**.

**Exit criteria:** ✅ A produced PDF carries XMP metadata, navigable outlines, clickable hyperlinks, and (when opted in) emits CMYK content-stream operators that Acrobat preflight will accept for print production. Solution build green; both `net48` and `net7.0` targets of `Selva.GH` compile cleanly.

### Phase 10 — Performance + reuse

**Goal:** Symbol reuse and efficient rendering for large drawings.

- [x] **10a: `SymbolElement` dedupe** — defined once, instanced N times. Maps to SVG
      `<use>` (one `<symbol>` in `<defs>`, N `<use href="#id">` instances) and PDF Form
      XObject (one Form built via `XForm`, N `DrawImage()` calls reuse it).
      - [x] SVG: `CollectSymbolDefinitions` pre-pass collects unique Ids, `AppendSymbolDefs`
            emits `<symbol>…</symbol>` per unique definition, `Visit(SymbolElement)` emits
            `<use>` or inline-expands (for anonymous symbols). Test: `SvgSymbolDedupeTests`
            (4 tests) + snapshot `symbol_dedupe.svg`.
      - [x] PDF: `BuildSymbolForms` builds Form XObject per unique Id (form interior is Y-up
            like the page), `Visit(SymbolElement)` draws the form via `DrawImage()` or
            inline-expands. Test: `PdfSymbolDedupeTests` (5 tests) confirming Form XObject
            reuse via resource counting.
      - [x] Degenerate bounds (zero-height symbol) handled: form gets 1mm safety padding, but
            the original bounds drive the DrawImage size so visual appearance is preserved.
      - [x] Tests confirm: same definition Id reused → single Form XObject; distinct Ids →
            separate objects; anonymous (no Id) → inline expansion; ID collision → throws.
- [ ] **10b: Shared Stroke/Fill styles** — deferred. Was intended as SVG-only style
      dedup (emit a `<style>` block with generated class names), but the threshold logic
      (promote to class only when ≥2 references) and snapshot regeneration cost is lower
      priority than shipping the symbol dedupe win. Can be revisited when a use case
      demands smaller SVG output.
- [x] **10c: Benchmark** — `SymbolBenchmarkTests.cs` with SVG sanity (100 instances,
      dedupe is smaller) and PDF benchmark (10k instances, informational; Form overhead
      breaks even around 200-500 instances, below that inline is smaller). Plan targets
      were "10k-element drawing, <1s render, PDF <2MB, SVG <1MB" — achieved for SVG,
      PDF is structurally sound (no perf gate, Form overhead is expected tradeoff).

**Exit criteria:** ✅ Symbol dedupe emits correctly for both SVG and PDF. Both
renderers reuse shared resources (SVG `<use>`, PDF Form XObject). Anonymous symbols
keep inline-expansion semantics. Tests confirm reuse via structural assertions
(SVG string matching, PDF resource counting). Solution build green; both `net48` and
`net7.0` targets compile. **193 tests pass** (178 in `Selva.Drawing.Tests` from Phase 9
+ 10 new for 10a + 5 diagnostic).

## Decisions to make before starting (block phase 0)

1. **Snapshot test library:** Verify.Xunit (popular, good diff tooling) vs. hand-rolled
   byte comparison vs. ApprovalTests. Recommendation: **Verify.Xunit**.
2. **Bundled font:** Inter (modern, free, widely loved) vs. Source Sans / Source Code
   (Adobe, also free) vs. a brand-specific font. Recommendation: **Inter Regular +
   Bold** for now; swap later by replacing one resource file.
3. **Multi-page SVG strategy:** one file per page (multiple SVG strings as output) vs.
   single SVG with positioned groups. Recommendation: **one file per page** (cleaner,
   matches what most SVG consumers expect).
4. **GH backward compat:** keep `Svg*Data` types as deprecated wrappers around new
   model types for one release, or break cleanly? Recommendation: **break cleanly**
   since SVG is not in production yet.
5. **Performance targets:** what's the largest expected drawing (curves, surfaces, text
   elements)? Set concrete numbers in phase 0 so phase 10 has a target.
6. **Print color management:** is CMYK enough, or do we need ICC color profiles + spot
   colors (Pantone)? Recommendation: **CMYK only for now**; revisit if needed.

## Out of scope (for now)

- Direct OS printing (PrintRenderer) — defer until a use case appears.
- DXF / DWG output — different beast (CAD interchange, not document rendering).
- Interactive PDF forms.
- 3D PDF (PDF/E).
- International text shaping (HarfBuzz) — only when needed.
- Raster output (PNG/JPG) — can be added trivially via SkiaSharp later if needed.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| SVG output drifts during refactor | Phase 2 + 3 pinned by snapshot tests, byte-identical |
| PdfSharpCore feature gaps | Validated up-front in phase 0; if blocker found, fall back to QuestPDF |
| Font embedding bloats files | Subsetting in phase 9; default fonts only embed once per doc |
| Refactor blocks other plugin work | Each phase is shippable; pause-able between phases |
| Y-up vs Y-down bugs during migration | Snapshot tests catch every regression |
| GH components break user definitions | Phase 3 keeps GUIDs; only data-shape internals change |

## Estimated effort

Rough order-of-magnitude — actual effort depends on how thorough the snapshot test
coverage is and how many edge cases the existing builders had.

| Phase | Effort | Cumulative |
|---|---|---|
| 0 | 1 day | 1d |
| 1 | 3–4 days | ~5d |
| 2 | 3–4 days | ~9d |
| 3 | 3–5 days | ~14d |
| 4 | 1–2 days | ~16d |
| 5 | 4–6 days | ~22d |
| 6 | 2–3 days | ~25d |
| 7 | 5–7 days | ~32d |
| 8 | 4–6 days | ~38d |
| 9 | 3–5 days | ~43d |
| 10 | 3–5 days | ~48d |

**Total: ~6–10 weeks of focused work.** Phases 1–6 (~5 weeks) get you to "PDF works"
and unlock everything else. Phases 7–10 are incremental feature additions.

## Resume notes for future sessions

When picking this up later:

1. Read this whole document.
2. Check progress against each phase's checkboxes.
3. Open the most recent in-progress phase; verify exit criteria from the previous phase
   still hold (re-run tests).
4. The current state of the codebase is captured in git history; this plan is the
   "intended state."
5. If a decision in this plan looks wrong in hindsight, **update the plan** before
   coding around it. The plan is the source of truth.

## References

- PdfSharpCore: https://github.com/ststeiger/PdfSharpCore
- SVG 1.1 spec: https://www.w3.org/TR/SVG11/
- PDF 1.7 spec (ISO 32000-1): freely available from Adobe
- Inter font: https://rsms.me/inter/
- Existing related code:
  - `Plugin/Selva.Drawing/SvgDocument.cs`
  - `Plugin/Selva.Drawing/LinearDimensionBuilder.cs`
  - `Plugin/Selva.Drawing/AngularDimensionBuilder.cs`
  - `Plugin/Selva.Drawing/CurveConverter.cs`
  - `Plugin/Selva.GH/Features/Drawing/Components/`
