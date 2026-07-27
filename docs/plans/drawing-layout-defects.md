# Drawing layout & pagination — defect register and resolve plan

Status: **not started** (register only). Created 2026-07-27.
Scope: `Plugin/Selva.Drawing` layout (`Model/Layout/`, `Model/Drawings/DrawingView.cs`) and the
two renderers where they disagree.

33 defects were found by an audit that reproduced every one by running code against the live
assembly. 14 were adversarially re-verified by an independent probe; the other 19 carry the
original probe output but have **not** been independently re-run — treat those as strong leads,
not established facts, and reproduce before fixing.

---

## READ THIS FIRST — the working tree is dirty and some defects are self-inflicted

Everything from the 2026-07-27 session is **uncommitted on branch `beta`**. `git status` shows
~27 modified + 9 new files across `Selva.Drawing`, `Selva.Drawing.Tests` and `Selva.GH`.

**Seven of the defects below were introduced by that same session's fixes.** They are marked
🔴 REGRESSION. They are not shipped, so the cheapest resolution for some may be to revise or
revert the change that caused them rather than patch on top. Decide that before writing code.

What that session shipped (do not re-investigate these — they are fixed and tested):

1. `Stroke.Width = 0` emitted PDF `0 w` (device-dependent hairline). Now `0` = **no stroke**.
2. `DimensionElement.Offset` was not counter-scaled → collapsed at small view scales.
3. `Fill` hatch spacing / `HatchElement.Spacing` were not counter-scaled.
4. Unstyled `PathElement` was 0.25 mm in PDF but 1.0 mm in SVG.
5. Hatch line width was a duplicated `0.3` literal in both renderers; the SVG `<pattern>` cache
   key ignored spacing/width so different tiles collided.
6. `Stack.BuildChildContext` gave children an infinite main axis → auto-fit views overflowed.
7. `Grid` Pass-1 measured cells with an empty context → auto-fit views reported unbounded size.
8. `PaginationPass.TrySplitElement` / `ForcePlaceElement` treated `GroupElement` as atomic and
   never resolved it, so views in a single Page branch never saw the page context.

Tests at time of writing: **386 pass**. A green suite proved nothing here — most of the defects
below coexisted with it. See "Test gaps" at the end.

---

## How to reproduce anything in this register

Probe recipe (this took several attempts to get right; use it verbatim):

```
scratchpad: C:\Users\Felix\AppData\Local\Temp\claude\d--Coding-selva\<session>\scratchpad
mkdir -p the FULL path first and confirm it exists before cd — a failed `cd` once wrote a
Program.cs into Selva.Drawing.Tests and broke that project's build.
```

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>disable</Nullable></PropertyGroup>
  <ItemGroup><ProjectReference Include="d:/Coding/selva/Plugin/Selva.Drawing/Selva.Drawing.csproj" /></ItemGroup>
</Project>
```

`dotnet run -c Debug` — **Debug matters**: Release ILRepacks and internalizes PdfSharpCore, so
`PdfReader`/`PdfDictionary` become inaccessible.

Reading an emitted PDF content stream:

```csharp
using var doc = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);
foreach (var item in doc.Pages[0].Contents.Elements) {
    var s = (item as PdfReference)?.Value as PdfDictionary;
    if (s?.Stream != null) sb.Append(Encoding.Latin1.GetString(s.Stream.UnfilteredValue));
}
// using PdfSharpCore.Pdf; PdfSharpCore.Pdf.IO; PdfSharpCore.Pdf.Advanced;
```

API gotchas that cost time: grid tracks are `GridLength.Auto` / `.Star(w)` / `.Absolute(mm)`;
`Frame`'s child is `Child` not `Content`; `TextFlow`'s width is `Width` not `MaxLineWidth`;
`DrawingView.Resolve` needs a `LayoutContext`; `PaginationPass.PaginateBody(content, paper,
margins, bands)` returns `SectionLayout { RawContents, PageRect, ContentRect, HeaderRect,
FooterRect }`.

---

## The three root causes

Fourteen confirmed defects reduce to three mechanisms. Fixing per-symptom will keep producing
regressions — the 2026-07-27 session did exactly that twice.

**A. Measure ≠ resolve.** A container measures a flexible child against a budget it then
contradicts when it actually places the child. Seven defects. The deep version: `TrySplit` and
`Resolve` are two independent loops that must agree, and currently don't.

**B. Zero treated as absent.** A `0` main-axis budget, a `BoundingBox.Empty` content rect, and a
zero-extent geometry are each read as "unconstrained" rather than "no room". Four defects.
`LayoutContext` already distinguishes these (`HasFiniteAvailableWidth` vs `AvailableWidth`) —
the consumers ignore it.

**C. Paper-space invariance holes.** Same family as fixed items 2/3/5; still open on five paths.

---

## Confirmed defects (independently re-verified)

### C1 🔴 REGRESSION — Stack budget is stolen by empty children

`Model/Layout/Stack.cs:359` (spacing reserve) **and `:335`/`:59`** (`ShareOf` denominator)

Empty-bounds children are skipped by the placement loop (`:112-116`) and by `totalMain` (`:86`),
so they are never spaced — but both the `Spacing*(Count-1)` reserve and the `ShareOf` divisor
count them.

```
view alone                     -> stack height 100      (page budget 100)  correct
+1 empty sibling               -> 40
+3 empty siblings              -> 10
+5 empty siblings              -> 479.259               balloons past the page
```

Fixing only `:359` is wrong — with `Spacing=0` the same case still gives `100/6`. Fix both.
It also escapes pagination: `TrySplit` sees no overflow (`overflowChildren.Count==0`, `:233`)
and returns the ballooned `Resolve` as `AllFits`.

**User impact:** a conditionally-empty branch (empty nested Stack, blank TextFlow) silently
rescales every view on the sheet.

### C2 🔴 REGRESSION — exhausted budget (0) read as unconstrained

`Model/Layout/Stack.cs:70` → fault lands in `Model/Drawings/DrawingView.cs:109-116`

`remainingMain` clamps to 0; `BuildChildContext` builds `BoundingBox(0,0,w,0)`, which is _valid_,
so `HasFiniteAvailableHeight` is true but `AvailableHeight == 0` — and `DrawingView` falls into
the `else if (availW > 0)` arm and fits to width with **no height limit**.

Trigger is `0 ≤ remaining ≤ paddingSum` (default 4 mm), not exactly 0: `ctx h=10` → 10,
`ctx h=1` → **1106.76**. Vertical stacks get rescued by `TrySplit`; **horizontal ones do not**
(atomic to pagination) — `Stack{H,[Rect 200×20, View 400×30]}` → one page **3154.85 mm** wide.

**Fix belongs in `DrawingView`**, not `Stack`: honour `HasFiniteAvailable*`, which already
distinguishes zero from absent.

### C3 🔴 REGRESSION — nested `Stack.TrySplit` gets the full-page budget

`Model/Layout/Stack.cs:218` (delivery), **`:263`** (fault)

`childContext` is built once at `:169` from the whole `availableHeight`, never from `remaining`.
The nested stack's `Resolve(context)` therefore sizes against the entire page while the parent
has only `remaining` left, and the parent accepts the returned `FitsHeight` unchecked.

```
100x100 content rect -> page0 h=170.25   (overflow 70.25)
inner.TrySplit(30, ctx h=100) -> FitsHeight=100
inner.TrySplit(30, ctx h= 30) -> FitsHeight=30     <- correct when the context is narrowed
```

Only at nesting depth ≥1; flat stacks are correct. **Not** a revert of fixed-item 6.

### C4 🔴 REGRESSION — `TrackCeiling` ignores committed track sizes

`Model/Layout/Grid.cs:259`

`available / trackCount` never subtracts the Absolute tracks that will consume the space.

```
[Absolute(150), Auto] on a 190 rect -> grid width 245   (33 mm off an A4 sheet)
one Auto beside 4x Absolute(1)      -> Auto gets 38.0, wraps to 3 lines
```

Correct ceiling: `budget − spacing − committed`, divided among the **unknown** tracks only.
A naive "budget − known" reintroduces fixed-item 7 (2×Auto → 380 on a 190 budget) and breaks
`StackDrawingViewFitTests.Grid_of_auto_tracks_holding_tall_views_stays_inside_the_content_rect`.

### C5 — Auto tracks inflate to the measure ceiling

`Model/Layout/Grid.cs:293` with `Model/Layout/TextFlow.cs:41`/`:151`

Any width-filling child reports the ceiling it was measured against as its natural width, and
`LargestNaturalSizeOnTrack` makes the track equal to it. Auto becomes byte-identical to Star.

```
2x Auto TextFlow cells:  unconstrained 7.92 | ctx 200 -> 200.00 | ctx 400 -> 400.00
Table with 3 Auto cols:  34.60 unconstrained vs 190.00 on a page
```

Plain `TextElement` cells are unaffected — this is specifically the TextFlow bounds contract.

### C6 — TextFlow reports wrap width, not ink width

`Model/Layout/TextFlow.cs:151`, `:41`

Root cause of C5. `Resolve` pins `BoundsOverride` width to `effectiveWidth`.
"Qty" (4.96 mm of ink) → a 63.33 mm column. `Frame{Border,"NOTE"}` → 190 mm wide.
`CrossAlign.Center` can never centre a TextFlow ('SHORT' lands at x=0.00 on a 190 mm page).

Fix: report `Math.Min(MaxLineWidth(lines), effectiveWidth)` as bounds while keeping the wrap box
separate — the Center/Right anchor arithmetic at `:124-132` deliberately needs the wrap box.
**C4 + C5 + C6 are one coordinated change.**

### C7 — Star tracks not recomputed after Pass 3 grows Auto rows

`Model/Layout/Grid.cs:218`

`ResolveTrackSizes` sizes Star as `available − Σnon-star` using Pass-1 Auto heights; Pass 3 then
grows those Auto rows and never re-derives Star. Row axis only.
`190×54` → pinned h **80.14** (grown Auto 43.56 + stale Star 36.58). With `[Auto,Star,Auto]` ink
reaches y = −16.1 mm. Fix: re-derive `starBudget` after Pass 3 → 60.000 exactly.

### C8 — `TextFlow.TrySplit` int-casts `+Infinity` → one page per line

`Model/Layout/TextFlow.cs:57` — **highest-value single fix**

```
(int)Math.Floor(inf / lineHeight) = -2147483648   -> fitsLineCount <= 0 -> NothingFits
TrySplit(+Inf)  -> Fits=NULL, Overflow=present
TrySplit(1000)  -> Fits=present                    (control)
```

`DocumentLayoutPass` passes `double.PositiveInfinity` for a **KeepTogether** section, and
`PaginateBody` does the same when the content rect collapses. ForcePlace then emits one line and
defers the rest forever: a 211-line note → **211 pages, one line each**; past 2000 lines it
throws `InvalidOperationException` (`PaginationPass.cs:127`) and renders nothing. Table and Stack
return 1 page under the same budget.

Fix: `if (double.IsPositiveInfinity(availableHeight) || fitsLineCount >= lines.Count) return
base.TrySplit(...)`. **Audit for the same unchecked `double→int` pattern elsewhere.**

### C9 — empty content rect disables pagination

`Model/Layout/PaginationPass.cs:110`

`ShrinkVertical` → `Empty` → `availableHeight = +Infinity` → everything "fits".
`AnchorTopLeft` also no-ops (`available.IsEmpty`), so content is emitted at raw model coords.

```
HeaderHeight 276.9 -> 10 pages          148.4 margins -> 10 pages
HeaderHeight 277.0 ->  1 page, bounds y 0..400 on a 297 sheet   (103 mm off the top, lost)
```

A 0.1 mm change flips the result. Fix: empty rect ⇒ `availableHeight = 0`.

### C10 — tokens substituted after layout

`Model/Layout/PaginationPass.cs:323`

`LayoutPass.Resolve` runs **before** `resolver.ResolveTree`, so a header TextFlow wraps the
literal `"{title}"` and the substituted value is never line-broken or re-measured.

```
one TextElement, advance 562.53 mm, right edge 572.53 on a 210 mm sheet (~372 mm clipped)
band reserved 5.808 mm from "{title}"; real text needs 17.423 mm
reported bounds are the stale 190 mm wrap box, so no overflow check can see it
```

Affects every length-changing token (`{page}`, `{date}`, user tokens) and reaches `GH_TitleBlock`.
Fix substitution order **and** the band re-measure together.

### C11 — default `Margin` placement lets a band overprint the body

`Model/Layout/PaginationPass.cs:188`

`ContentReserve` returns 0 for `Margin` while `ComputeHeaderRect` anchors at `paper.HeightMm`.
`Margin` and `Edge(EdgeOffset=0)` produce the **identical band rect**, but only Edge shrinks the
body. 40 mm auto-measured header, 10 mm margin → header `[10,257..90,297]` vs body
`[10,87..110,287]` = **30 mm overlap**, no clip in either renderer. This is the default config
(Margin placement + null HeaderHeight = auto-measure).

Fix: reserve `max(0, bandHeight − margin)` for Margin; reuse the Edge path.

### C12 — zero-extent geometry ⇒ Infinity scale ⇒ NaN in the PDF

`Model/Drawings/DrawingView.cs:110`

```
SVG:  <g transform='matrix(NaN NaN NaN NaN NaN NaN)'>
PDF:  NaN NaN NaN NaN NaN NaN cm / NaN NaN m      (3217 bytes, no exception thrown)
selva:scale metadata = "Infinity" -> a title block's {scale} token prints "Infinity"
auto-fit: the view's bounds go EMPTY and it vanishes from the stack entirely
```

Needs zero extent on **both** axes (`Math.Min` guards single-axis); reachable via fill-only
collapsed paths and `ImageElement{Width=0,Height=0}`. The single-axis branches at `:112`/`:114`
divide unguarded. A drafting engine must never emit `NaN` into a content stream.

### C13 — layout elements below the root of `Geometry` escape counter-scaling

`Model/Drawings/DrawingView.cs:73`

`Resolve` pre-resolves `Geometry` only when the **root** is a `LayoutElement`. A Frame/Stack/
Grid/Table one level down (inside a `GroupElement`) survives `CounterScalePaperSpaceStyles` via
the `default:` arm, and `LayoutPass.Resolve` expands it afterwards.

```
scale 0.1, Frame as Geometry root:     border 7    -> 0.7 mm   correct
scale 0.1, Frame inside a Group:       border 0.7  -> 0.07 mm  wrong
```

Error is 1/Scale, unbounded. Secondary: the subtree is also resolved against the _outer_ page
context. Resolving the geometry subtree **before** counter-scaling fixes both; merely recursing
the counter-scale walk fixes only one.

### C14 — `CounterScalePaperSpaceStyles` skips `SymbolElement` (and `TextBlockElement`)

`Model/Drawings/DrawingView.cs:365`

The switch handles TextElement, PathElement, HatchElement, DimensionElement, LeaderElement,
GroupElement. `SymbolElement.Definition.Children` ride the transform raw — 0.7 mm emitted as
`0.7` where it should be `7` at 1:10. Symbols (north arrows, section marks, weld symbols) are
exactly the content that must stay fixed on the sheet.

Needs the Definition walked **and** a scaled `Definition.Id`, or the renderer's symbol dedupe
cache will collide across scales.

`TextBlockElement` is skipped by the same `default:` arm but is **not reachable from
Grasshopper** (only construction site is `TokenResolver.cs:86` rewriting an existing one) — fix
for defence-in-depth, not as a user-visible bug.

---

## Unverified leads (19) — reproduce before acting

Original probe output exists but was not independently re-run. Roughly ordered by claimed value.

| #       | Claim                                                                                                                                                                           | Location                | Headline number                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 🔴   | **`ShareOf` divides by children-left, so sibling COUNT sets the drawing scale.** `PerChildMainBudget`'s own comment says it does _not_ do this — `ShareOf` does.                | `Stack.cs:338`          | `[view]` → 100; `[view, caption]` on A4 → stack 145.58 of a 277 rect, **47% of the sheet blank**. The single most common drafting layout.                                 |
| U2 🔴   | Enlargement views lose **all** linework: `Stroke.IsVisible` is evaluated on the counter-scaled _local_ width, not the authored paper width. Direct consequence of fixed-item 1. | `PdfRenderer.cs:1410`   | 20:1 → 0.13 mm path MISSING; 25:1 → both MISSING; a 25:1 or 50:1 detail view exports a **blank page**. Hatch meanwhile prints up to 2 mm.                                 |
| U3 🔴   | `TrySplit` measures greedily (`availableHeight − consumed`) while `Resolve` uses fair-share — the two loops disagree about every auto-fit child.                                | `Stack.cs:188`          | Unpaginated 1 page / view h=49.9; via `PaginateBody` 2 pages / view h=99.6. Same document renders differently depending on whether pagination ran.                        |
| U4      | SVG dimension linework emits `vector-effect='non-scaling-stroke'` **and** is counter-scaled — the two stack. PDF has no equivalent.                                             | `SvgRenderer.cs:1032`   | 1:50 → SVG 12.5 mm bars where PDF gives 0.25 mm. Same sheet, two formats, different output.                                                                               |
| U5      | Caption height is stapled on after sizing, outside every budget.                                                                                                                | `DrawingView.cs:103`    | Auto-fit into a 277 rect → 281.52 (4.52 over, straight into the footer). Size 60×40 → 60×44.52.                                                                           |
| U6      | Padding never clamped; auto-fit has a cliff when available − padding hits 0.                                                                                                    | `DrawingView.cs:89`     | Size 20×20 + padding 20 → outer 40×40. Auto-fit available 20×20: padding 9 → 20×19.2, padding 10 → **70.5×50.5**.                                                         |
| U7      | View scale derived from **stroke-inflated** bounds, so line weight changes the drawing scale.                                                                                   | `DrawingView.cs:76`     | 20 mm model, 1.0 mm stroke, Length=20 → scale 1:1.05, caption says so; the 20 mm edge measures 19.05 mm. Two views of the same geometry at different weights don't align. |
| U8      | Leading empty child makes `TrySplit` emit a spurious blank page (`fitsChildren.Count` counts children, not extent).                                                             | `Stack.cs:240`          | 1 page → 2 pages; page0 has EMPTY bounds and 0 `<path>` elements.                                                                                                         |
| U9      | `AnchorChrome` top-aligns the footer, so an oversize footer grows **downward** off the sheet.                                                                                   | `PaginationPass.cs:357` | reserve 8, content 30 → placed `[10,-12 .. 190,18]`, 12 mm below the paper edge.                                                                                          |
| U10     | Table `RowHeight` under-reports its box; surplus text draws outside and nothing clips.                                                                                          | `Table.cs:87`           | reported H=5.0 while ~17 mm of text is drawn; ~13.5 mm hangs below its own bottom edge.                                                                                   |
| U11     | Spanning cells split natural/span with no backfill; grid under-reports its own bounds.                                                                                          | `Grid.cs:347`           | pinned w=60.125 while the spanning path is drawn to x=100.25.                                                                                                             |
| U12     | `SymbolElement` Position+Transform order disagrees between `ComputeBounds`, SVG `<use>`, and SVG-inline/PDF.                                                                    | `SvgRenderer.cs:927`    | bounds say x 139.5..160.5; inline SVG draws at 70..90. Moves the moment the Definition gets an Id.                                                                        |
| U13     | `GH_Grid` viewport preview resolves the grid at a size the grid doesn't fit in (measurement is not a fixed point).                                                              | `GH_Grid.cs:220`        | natural h=5.08 → resolve(natural) h=10.16. Preview ≠ export.                                                                                                              |
| U14     | Negative margins push the content rect and both bands off the paper.                                                                                                            | `PaginationPass.cs:272` | page rect exceeds a 210×297 sheet by 10 mm on every side; both bands entirely off-sheet.                                                                                  |
| U15     | Cells outside the declared tracks are drawn outside the grid and never reported by `ComputeOverflows`.                                                                          | `Grid.cs:147`           | leaves drawn 10 mm below and 30 mm right of the grid box; overflow count reports only a stroke-inflation artefact. Not reachable via `GH_Grid` (it validates).            |
| U16     | `Table.ColumnWidths` silently discarded when shorter than the column count (all-Star fallback).                                                                                 | `Table.cs:399`          | 2 widths for 3 cols → every declared width ignored. `GH_Table.WarnOnCountMismatch` does emit a remark.                                                                    |
| U17–U19 | Duplicates of C13/C14 found independently by a second agent (`DrawingView.cs:73`, `:259`, `:345`) — cross-check their numbers when fixing C13/C14; they add per-scale tables.   | —                       | TextBlockElement: scale 0.02 → 4 emitted as 4, should be 200.                                                                                                             |

---

## Recommended order

**Stage 0 — decide on the regressions first.** C1, C2, C3, C4, C5, U1, U2, U3 all come from the
uncommitted 2026-07-27 work. Options: (a) fix forward, (b) revert the Stack/Grid budget changes
and re-approach, keeping fixed-items 1–5 and 8 which are independent and sound. Recommend
deciding this before touching anything — fixing forward is ~2 coordinated rewrites.

**Stage 1 — cheap, isolated, high value** (1–2 lines each, no interactions):

1. C8 `TextFlow.cs:57` — the `+Infinity` cast guard. Do this first regardless of Stage 0.
2. C9 `PaginationPass.cs:110` — empty rect ⇒ 0, not `+Inf`.
3. C12 `DrawingView.cs:110` — clamp `effectiveScale`; guard `:112`/`:114`.
4. C7 `Grid.cs:218` — re-derive Star budget after Pass 3.
5. C14 `DrawingView.cs:365` — add the `SymbolElement` arm (+ scaled `Definition.Id`).

**Stage 2 — medium, self-contained:** 6. C2 via `DrawingView.cs:109-116` — honour `HasFiniteAvailable*` (kills C2 in both orientations). 7. C10 `PaginationPass.cs:323` — substitution before layout, plus re-measure. 8. C11 `PaginationPass.cs:188` — reserve `max(0, band − margin)` for Margin placement. 9. C13 `DrawingView.cs:73` — `LayoutPass.Resolve` the geometry subtree before counter-scaling. 10. U2 — evaluate `IsVisible` on authored paper width, not counter-scaled local width.

**Stage 3 — structural, one coordinated change each, do not do piecemeal:** 11. **Stack budget allocation** (C1, C3, U1, U3): exclude zero-extent children from both the
spacing reserve and the `ShareOf` denominator; narrow the nested `TrySplit` context to
`remaining`; make `TrySplit` and `Resolve` share one allocation routine; stop trusting
`AllFits`/`FitsHeight` from a `Resolve` that was never re-bounded against `availableHeight`. 12. **Grid Auto sizing** (C4, C5, C6): `TrackCeiling` = budget − spacing − committed, split among
_unknown_ tracks only; `TextFlow` reports `min(ink, effectiveWidth)` as bounds while keeping
the wrap box for anchor maths.

---

## Test gaps that let all of this through

The suite passes 386 tests and caught none of these. Worth fixing as part of the work:

- **No invariant test.** Add a matrix test asserting "resolved content never exceeds the content
  rect" across the cross-product of {Stack V/H, Grid Auto/Star/Absolute, Frame, Table, TextFlow,
  bare Group} × {nesting depth 0–2} × {view scale 1, 0.1, 0.02} × {captioned, not}. Every
  container added later then inherits the guarantee instead of the bug.
- **No `TrySplit` ≡ `Resolve` test.** These are two loops that must agree and are never compared.
  Assert that paginating a document that fits on one page yields byte-identical geometry to
  resolving it directly.
- **No degenerate-input tests.** Zero-extent geometry, empty content rect, `+Infinity` budgets,
  negative margins, zero-size tracks — every one of these produced a defect.
- **No PDF↔SVG parity test.** U4 (dimension strokes) and U12 (symbol placement) are both
  "the two renderers disagree", and nothing checks that.
- **Snapshot tests hid a bug.** Three pinned SVG snapshots encoded the 1.0 mm unstyled-path bug
  and had to be re-pinned. Snapshots lock in whatever was true at capture; they are not
  correctness checks.

## Provenance

Audit run 2026-07-27 by a 35-agent workflow (6 subsystem finders → dedupe → 2-lens adversarial
verification → synthesis), 2.7M subagent tokens. Full per-agent transcripts:
`C:\Users\Felix\.claude\projects\d--Coding-selva\605b86a4-888a-4160-8a9f-1f1343707c1f\subagents\workflows\wf_87c484a0-0e5\`
(`journal.jsonl` holds one result line per agent, including the 19 unverified findings with
their full probe output). C1/C4/C5 and the C8 cast were additionally re-confirmed by hand.

Verification caveat: 14 of 14 verified findings came back **unrefuted**, which is a suspiciously
clean rate. The lenses did correct several claims mid-flight (TextBlockElement reachability, the
nesting-depth qualifier on C3), and hand spot-checks matched — but treat the confirmed set as
"strongly evidenced", not "proven", and re-run the probe before each fix.
