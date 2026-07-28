# Drawing layout & pagination — defect register and resolve plan

Status: **Stages 1–3 complete** (13 fixed, 3 not reproduced). Created 2026-07-27, updated 2026-07-28.
Scope: `Plugin/Selva.Drawing` layout (`Model/Layout/`, `Model/Drawings/DrawingView.cs`) and the
two renderers where they disagree.

33 defects were found by an audit that reproduced every one by running code against the live
assembly. 14 were adversarially re-verified by an independent probe; the other 19 carry the
original probe output but have **not** been independently re-run — treat those as strong leads,
not established facts, and reproduce before fixing.

---

## Progress (2026-07-28)

**Stages 1, 2 and 3 are done.** Every fix was reproduced by probe before the change and is
covered by a test that fails without it.

| Stage | Fixed                  | Not reproduced |
| ----- | ---------------------- | -------------- |
| 1     | C8, C9, C12, C14       | C7             |
| 2     | C2, C10, C11, C13, U2  | —              |
| 3     | C1, C3, U1, C4, C5, C6 | U3, U8         |

Suite: **431 pass** (386 original + 45 new), zero failures. New test files:

- `Model/Layout/DegenerateInputTests.cs` (14) — infinite budgets, collapsed content rect,
  zero-extent geometry, symbol paper-space invariance.
- `Model/Layout/PaperSpaceInvarianceTests.cs` (15) — exhausted budgets, nested counter-scaling,
  enlargement linework, chrome overprint, token layout order.
- `Model/Layout/BudgetAllocationTests.cs` (16) — Stack and Grid budget division.

Against pre-fix code these fail 9/14, 8/15 and 11/16 respectively; the passing remainder are
paired controls (unit-scale Id preservation, single-axis fit, the "just fits" side of a boundary).

**Three findings did not reproduce and were NOT fixed: C7, U3, U8.** Details below — do not
treat their register entries as established.

Two corrections that affect how the rest of this register should be read:

1. **The premise of "READ THIS FIRST" is stale.** The 2026-07-27 work is committed as `b754a5cd`
   ("Repair documnet lib") on `beta`, not sitting uncommitted. Stage 0's revert-vs-fix-forward
   is therefore a decision about reverting a shipped commit, which raises the bar for reverting.
2. **Fixing one defect can unmask another.** C9 did not reproduce at all until C8 was fixed —
   the `+Infinity` cast bug was making everything overflow and hiding the empty-rect collapse.
   **Re-probe after each fix**, rather than trusting one up-front reproduction pass.

---

## READ THIS FIRST — some defects are self-inflicted

**Seven of the defects below were introduced by the 2026-07-27 session's own fixes.** They are
marked 🔴 REGRESSION. They are **shipped** (commit `b754a5cd` on `beta`), so reverting is no
longer free — decide between revising the change that caused them and patching on top before
writing code.

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

## Stage 1 outcome (2026-07-28)

| ID  | Result                                                                             |
| --- | ---------------------------------------------------------------------------------- |
| C8  | ✅ Fixed. Reproduced exactly (`TrySplit(+Inf)` → `Fits=NULL`).                     |
| C9  | ✅ Fixed. **Only reproduced after C8 was fixed** — see note below.                 |
| C12 | ✅ Fixed. Reproduced exactly (`selva:scale=Infinity`, NaN in the group transform). |
| C14 | ✅ Fixed. Reproduced exactly — symbol stroke stayed `0.700` at every scale.        |
| C7  | ❌ **Did not reproduce.** Not fixed. See below.                                    |

**C8** — guard added before the cast in `TextFlow.TrySplit`. The register's follow-up ("audit for
the same unchecked `double→int` pattern elsewhere") was done: the only other casts in `Model/` are
`DrawingView.cs:477` and `DocumentLayoutPass.cs:207`, both `Math.Round` on an already-finite
scale. **No other instances — that audit item is closed.**

**C9** — `contentRect.IsEmpty` now yields `0.0`, not `+Infinity`. Note the ordering trap: with C8
still broken, both sides of the 276.9/277.0 boundary returned 120 pages and the defect was
invisible. After the C8 fix, HeaderHeight 277.0 collapsed to **1 page spanning y 0..435 on a
297 mm sheet** — the register's described symptom, revealed only by fixing something else first.
The related `AnchorTopLeft` no-op on an empty rect (`AnchorChrome` returns content unmoved when
`available.IsEmpty`, `PaginationPass.cs:346`) is **still open** — with `availableHeight = 0`
pagination now makes progress, so it no longer produces off-sheet output, but the anchor
arithmetic is still skipped. Left as-is; revisit with C11.

**C12** — replaced the four unguarded divisions with `FitScale` / `AxisScale` / `IsUsableScale` in
`DrawingView`. A geometry flat on **one** axis now fits against the axis that has extent rather
than dividing by zero (the register's claim that `Math.Min` already guarded the single-axis case
was right for the two-axis arm but not for the `else if` arms at `:112`/`:114`).

**C14** — added `SymbolElement` **and** `TextBlockElement` arms to
`CounterScalePaperSpaceStyles`. The register called the scaled `Definition.Id` a
cache-collision nicety; it is stronger than that: `PdfRenderer.cs:418` **throws
`InvalidOperationException`** when one Id maps to two different definitions, which is exactly
what two views of the same symbol at different scales now produce. The Id qualification is
load-bearing, and a test pins that an unscaled (1:1) symbol keeps its original Id.

**C7 — could not reproduce.** `[Auto,Star]` and `[Auto,Star,Auto]`, single Star column, TextFlow
in the Auto row that genuinely grows during Pass 2, on the register's own `190×54` budget: both
resolve to **h = 54.000 exactly, minY = 0.000**. Not the claimed 80.14 / y = −16.1. Either
`b754a5cd` already fixed it or the original probe's grid differed in some way the register does
not record. **Do not fix from this entry** — recover the original construction from the workflow
journal first. `ResolveTrackSizes` does still compute the Star budget from Pass-1 Auto heights and
never re-derives it after Pass 3 grows those rows, so the _mechanism_ the register describes is
real in the code; what is unproven is that it produces the claimed overflow.

---

## Stage 2 outcome (2026-07-28)

All five reproduced exactly as written, and all five are fixed.

**C2** — `DrawingView.cs`. The auto-fit arm collapsed "axis constrained but exhausted" and "axis
unconstrained" into the same `0` and then took the single-axis branch, fitting to width with no
height limit. Both are now `double?`: a constrained axis stays in the fit at its real budget
however small, and only a genuinely unconstrained axis drops out. `FitScale`/`AxisScale` were
reworked at the same time — their earlier `scale > 0` guard would have re-broken C2 by treating a
legitimate zero budget as "no constraint", so the 1.0 fallback now applies only to a **non-finite**
ratio and a finite zero is honoured. Horizontal stack of two auto-fit views on a 190 mm rect:
**3789 mm → 190.00 mm**.

**C13** — `DrawingView.cs:73`. Fixed in one line by pre-resolving with
`LayoutPass.Resolve(Geometry, …)` instead of hand-rolling a root-only `is LayoutElement` check;
that helper already performs exactly the recursive walk this needed. A Frame inside a Group went
from emitting **zero** counter-scaled strokes to matching the root case byte-for-byte.

**C11** — `PaginationPass.cs:188`. `Margin` now reserves `max(0, bandHeight − margin)`, sharing
the Edge arm's logic. 40 mm header on a 10 mm margin: **30 mm overlap → 0**. A band that fits
inside the margin gap still costs the body nothing, which is the point of Margin placement.

**C10** — the substitution order was inverted in both `PaginationPass.ResolveChromeForPage` and
the band measurement, so layout now wraps the substituted value. Two things the register did not
mention, both of which the fix required:

1. **`TokenResolver.ResolveTree` had no `TextFlow` arm.** It only rewrote `TextElement` and
   `TextBlockElement` — i.e. _resolved_ output. Substituting before layout would have silently
   done nothing for the one element type that wraps. Added.
2. **Band height is circular** — it depends on substituted text, `{pages}` depends on page count,
   and page count depends on band height. `PaginationPass` now measures with a provisional
   resolver, paginates, re-measures against the settled page count, and re-paginates only if the
   reserve grew (one correction converges; a band that only grows cannot oscillate).
   `DocumentLayoutPass` measures per section with the real title/section name.

**U2 — reproduced, and worse than the register claims.** The register says 25:1 and 50:1 lose
some linework and that "hatch meanwhile prints up to 2 mm". In fact at **50:1 every standard line
weight disappears** — 0.13, 0.25 _and_ 0.5 mm — so the page is blank, and **hatch vanishes too**
(0.0052 mm, `IsVisible=false`). The mechanism: `MinVisibleWidthMm` is a device threshold about
the printed sheet, but it is tested against the counter-scaled _local_ width, and on an
enlargement the counter-scale is a fraction. Fixed in `ScaleStrokeWidth` (and applied to
`Fill.PatternLineWidthMm`) rather than in the renderers, because the renderers never see the view
scale and the authored width is only known at counter-scale time. A stroke the author made
visible stays visible; a deliberate `Width = 0` still scales to nothing.

---

## Stage 3 outcome (2026-07-28)

### Stack budget allocation — C1, U1, C3 fixed; U3, U8 not reproduced

**The root cause was `ShareOf` alone.** The register hedged between the spacing reserve
(`Stack.cs:359`) and the `ShareOf` divisor; the probe settles it. With `Spacing = 0` the
five-empty-siblings case still returned `100/6 = 16.667`, so **the spacing reserve is a red
herring** — the divisor is the whole defect. `ShareOf` divided the remaining budget by the number
of children still to be measured, counting children that go on to occupy nothing.

The replacement is not a smarter divisor. Each child is now measured against the **whole**
remaining budget as a ceiling, and a correction pass afterwards — once every child's actual
appetite is known — proportionally shrinks only the flexible children if the run overran. Doing
it after measurement is what makes empty children free: they take no share because they turned
out to need none. `ShareOf` is deleted (it had no other callers).

One wrinkle worth keeping: a child asked for N mm rarely returns exactly N, because padding,
borders and stroke inflation are fixed costs that do not shrink with the geometry. A single
proportional pass therefore landed **0.08 mm over** a 190 mm budget. The correction loop iterates
(capped at 4) until it fits.

- C1: view + {0,1,3,5} empty siblings → **100.000 mm in every case** (was 100 / 50 / 25 / 16.7).
- U1: view + caption → the view keeps its **190 mm** and the caption adds 4.36 mm, instead of the
  view shrinking to 142.86 mm and leaving 48% of the sheet blank.
- C3: `TrySplit(30)` now reports `FitsHeight = 30.000` whatever context the caller passes.
  Fixed at **both** ends — the nested call site narrows its context to `remaining`, and
  `TrySplit` itself clamps the incoming context (`BuildSelfContext`) so it no longer depends on
  callers behaving. The parent also stopped trusting a reported `FitsHeight` over the geometry
  the child actually produced.

**U3 did not reproduce.** Unpaginated vs `PaginateBody`: identical (`h=277.000`, first view
`138.500` before the fix, `190.000` after). The register's claim of 1 page/49.9 mm vs 2
pages/99.6 mm did not appear. **U8 did not reproduce** either — a leading empty child produced
one page, not two, with non-empty bounds.

### Grid Auto sizing — C4, C5, C6 all fixed as one change

C6 is the root cause and the register was right to insist these are one change.

**C6** — `TextFlow` pinned its reported bounds width to the wrap box, so "Qty" (5 mm of ink)
reported 190 mm on a page-width context. Now reports `min(ink, effectiveWidth)`. The cap matters:
a single unbreakable word can overrun the wrap box, and reporting more than the budget would push
the overflow back onto the container. **The anchor arithmetic still uses the wrap box** — the
register's claim that "`CrossAlign.Center` can never centre a TextFlow ('SHORT' lands at x=0.00)"
is **wrong**: centred text resolves to x=95.00 on a 190 mm context both before and after. That
arithmetic is correct and had to be preserved, which is why the fix separates reported bounds
from the wrap box rather than replacing one with the other.

**C5** follows directly: two Auto "Qty" columns now measure **9.923 mm at every budget** (was
9.923 unconstrained, 200 at budget 200, 400 at budget 400 — i.e. Auto was byte-identical to Star).

**C4** — `TrackCeiling` now subtracts Absolute tracks and divides among the **unknown** tracks
only. `[Absolute(150), Auto]` on a 190 mm rect: **245 mm → 185.48 mm**. The register's warning
about the naive fix is real and is pinned by a test: dividing the whole remainder among each
unknown track independently lets 2 Auto columns sum to 380 on a 190 budget (fixed-item 7). Star
tracks stay in the divisor — their size is genuinely unknown at that point.

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

### C1 ✅ FIXED (2026-07-28) 🔴 REGRESSION — Stack budget is stolen by empty children

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

### C2 ✅ FIXED (2026-07-28) 🔴 REGRESSION — exhausted budget (0) read as unconstrained

`Model/Layout/Stack.cs:70` → fault lands in `Model/Drawings/DrawingView.cs:109-116`

`remainingMain` clamps to 0; `BuildChildContext` builds `BoundingBox(0,0,w,0)`, which is _valid_,
so `HasFiniteAvailableHeight` is true but `AvailableHeight == 0` — and `DrawingView` falls into
the `else if (availW > 0)` arm and fits to width with **no height limit**.

Trigger is `0 ≤ remaining ≤ paddingSum` (default 4 mm), not exactly 0: `ctx h=10` → 10,
`ctx h=1` → **1106.76**. Vertical stacks get rescued by `TrySplit`; **horizontal ones do not**
(atomic to pagination) — `Stack{H,[Rect 200×20, View 400×30]}` → one page **3154.85 mm** wide.

**Fix belongs in `DrawingView`**, not `Stack`: honour `HasFiniteAvailable*`, which already
distinguishes zero from absent.

### C3 ✅ FIXED (2026-07-28) 🔴 REGRESSION — nested `Stack.TrySplit` gets the full-page budget

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

### C4 ✅ FIXED (2026-07-28) 🔴 REGRESSION — `TrackCeiling` ignores committed track sizes

`Model/Layout/Grid.cs:259`

`available / trackCount` never subtracts the Absolute tracks that will consume the space.

```
[Absolute(150), Auto] on a 190 rect -> grid width 245   (33 mm off an A4 sheet)
one Auto beside 4x Absolute(1)      -> Auto gets 38.0, wraps to 3 lines
```

Correct ceiling: `budget − spacing − committed`, divided among the **unknown** tracks only.
A naive "budget − known" reintroduces fixed-item 7 (2×Auto → 380 on a 190 budget) and breaks
`StackDrawingViewFitTests.Grid_of_auto_tracks_holding_tall_views_stays_inside_the_content_rect`.

### C5 ✅ FIXED (2026-07-28) — Auto tracks inflate to the measure ceiling

`Model/Layout/Grid.cs:293` with `Model/Layout/TextFlow.cs:41`/`:151`

Any width-filling child reports the ceiling it was measured against as its natural width, and
`LargestNaturalSizeOnTrack` makes the track equal to it. Auto becomes byte-identical to Star.

```
2x Auto TextFlow cells:  unconstrained 7.92 | ctx 200 -> 200.00 | ctx 400 -> 400.00
Table with 3 Auto cols:  34.60 unconstrained vs 190.00 on a page
```

Plain `TextElement` cells are unaffected — this is specifically the TextFlow bounds contract.

### C6 ✅ FIXED (2026-07-28) — TextFlow reports wrap width, not ink width

`Model/Layout/TextFlow.cs:151`, `:41`

Root cause of C5. `Resolve` pins `BoundsOverride` width to `effectiveWidth`.
"Qty" (4.96 mm of ink) → a 63.33 mm column. `Frame{Border,"NOTE"}` → 190 mm wide.
`CrossAlign.Center` can never centre a TextFlow ('SHORT' lands at x=0.00 on a 190 mm page).

Fix: report `Math.Min(MaxLineWidth(lines), effectiveWidth)` as bounds while keeping the wrap box
separate — the Center/Right anchor arithmetic at `:124-132` deliberately needs the wrap box.
**C4 + C5 + C6 are one coordinated change.**

### C7 ❌ NOT REPRODUCED — Star tracks not recomputed after Pass 3 grows Auto rows

`Model/Layout/Grid.cs:218`

`ResolveTrackSizes` sizes Star as `available − Σnon-star` using Pass-1 Auto heights; Pass 3 then
grows those Auto rows and never re-derives Star. Row axis only.
`190×54` → pinned h **80.14** (grown Auto 43.56 + stale Star 36.58). With `[Auto,Star,Auto]` ink
reaches y = −16.1 mm. Fix: re-derive `starBudget` after Pass 3 → 60.000 exactly.

### C8 ✅ FIXED (2026-07-28) — `TextFlow.TrySplit` int-casts `+Infinity` → one page per line

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

### C9 ✅ FIXED (2026-07-28) — empty content rect disables pagination

`Model/Layout/PaginationPass.cs:110`

`ShrinkVertical` → `Empty` → `availableHeight = +Infinity` → everything "fits".
`AnchorTopLeft` also no-ops (`available.IsEmpty`), so content is emitted at raw model coords.

```
HeaderHeight 276.9 -> 10 pages          148.4 margins -> 10 pages
HeaderHeight 277.0 ->  1 page, bounds y 0..400 on a 297 sheet   (103 mm off the top, lost)
```

A 0.1 mm change flips the result. Fix: empty rect ⇒ `availableHeight = 0`.

### C10 ✅ FIXED (2026-07-28) — tokens substituted after layout

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

### C11 ✅ FIXED (2026-07-28) — default `Margin` placement lets a band overprint the body

`Model/Layout/PaginationPass.cs:188`

`ContentReserve` returns 0 for `Margin` while `ComputeHeaderRect` anchors at `paper.HeightMm`.
`Margin` and `Edge(EdgeOffset=0)` produce the **identical band rect**, but only Edge shrinks the
body. 40 mm auto-measured header, 10 mm margin → header `[10,257..90,297]` vs body
`[10,87..110,287]` = **30 mm overlap**, no clip in either renderer. This is the default config
(Margin placement + null HeaderHeight = auto-measure).

Fix: reserve `max(0, bandHeight − margin)` for Margin; reuse the Edge path.

### C12 ✅ FIXED (2026-07-28) — zero-extent geometry ⇒ Infinity scale ⇒ NaN in the PDF

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

### C13 ✅ FIXED (2026-07-28) — layout elements below the root of `Geometry` escape counter-scaling

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

### C14 ✅ FIXED (2026-07-28) — `CounterScalePaperSpaceStyles` skips `SymbolElement` (and `TextBlockElement`)

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

| #       | Claim                                                                                                                                                                            | Location                | Headline number                                                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 ✅   | **FIXED 2026-07-28.** `ShareOf` divides by children-left, so sibling COUNT sets the drawing scale. Confirmed; `ShareOf` deleted.                                                 | `Stack.cs:338`          | Reproduced: `[view]` → 190 of a 277 rect; `[view, caption]` → 142.86, **48% blank**. Now both keep the view at 190.                                                       |
| U2 ✅   | **FIXED 2026-07-28, worse than described.** Confirmed. At 50:1 **every** standard weight (0.13/0.25/0.5) vanishes — blank page — and hatch vanishes too, contra the claim below. | `PdfRenderer.cs:1410`   | Fixed in `ScaleStrokeWidth`, not the renderer: the renderers never see the view scale. See Stage 2 outcome.                                                               |
| U3 ❌   | **NOT REPRODUCED.** `TrySplit` measures greedily while `Resolve` uses fair-share — claimed the two loops disagree about every auto-fit child.                                    | `Stack.cs:188`          | Unpaginated and `PaginateBody` agreed exactly (h=277.000, first view 138.500 pre-fix / 190.000 post-fix). The claimed 1-page/49.9 vs 2-page/99.6 split did not appear.    |
| U4      | SVG dimension linework emits `vector-effect='non-scaling-stroke'` **and** is counter-scaled — the two stack. PDF has no equivalent.                                              | `SvgRenderer.cs:1032`   | 1:50 → SVG 12.5 mm bars where PDF gives 0.25 mm. Same sheet, two formats, different output.                                                                               |
| U5      | Caption height is stapled on after sizing, outside every budget.                                                                                                                 | `DrawingView.cs:103`    | Auto-fit into a 277 rect → 281.52 (4.52 over, straight into the footer). Size 60×40 → 60×44.52.                                                                           |
| U6      | Padding never clamped; auto-fit has a cliff when available − padding hits 0.                                                                                                     | `DrawingView.cs:89`     | Size 20×20 + padding 20 → outer 40×40. Auto-fit available 20×20: padding 9 → 20×19.2, padding 10 → **70.5×50.5**.                                                         |
| U7      | View scale derived from **stroke-inflated** bounds, so line weight changes the drawing scale.                                                                                    | `DrawingView.cs:76`     | 20 mm model, 1.0 mm stroke, Length=20 → scale 1:1.05, caption says so; the 20 mm edge measures 19.05 mm. Two views of the same geometry at different weights don't align. |
| U8 ❌   | **NOT REPRODUCED.** Leading empty child claimed to make `TrySplit` emit a spurious blank page.                                                                                   | `Stack.cs:240`          | With and without a leading empty child both gave **1 page**, non-empty bounds. The claimed 1→2 page split did not appear.                                                 |
| U9      | `AnchorChrome` top-aligns the footer, so an oversize footer grows **downward** off the sheet.                                                                                    | `PaginationPass.cs:357` | reserve 8, content 30 → placed `[10,-12 .. 190,18]`, 12 mm below the paper edge.                                                                                          |
| U10     | Table `RowHeight` under-reports its box; surplus text draws outside and nothing clips.                                                                                           | `Table.cs:87`           | reported H=5.0 while ~17 mm of text is drawn; ~13.5 mm hangs below its own bottom edge.                                                                                   |
| U11     | Spanning cells split natural/span with no backfill; grid under-reports its own bounds.                                                                                           | `Grid.cs:347`           | pinned w=60.125 while the spanning path is drawn to x=100.25.                                                                                                             |
| U12     | `SymbolElement` Position+Transform order disagrees between `ComputeBounds`, SVG `<use>`, and SVG-inline/PDF.                                                                     | `SvgRenderer.cs:927`    | bounds say x 139.5..160.5; inline SVG draws at 70..90. Moves the moment the Definition gets an Id.                                                                        |
| U13     | `GH_Grid` viewport preview resolves the grid at a size the grid doesn't fit in (measurement is not a fixed point).                                                               | `GH_Grid.cs:220`        | natural h=5.08 → resolve(natural) h=10.16. Preview ≠ export.                                                                                                              |
| U14     | Negative margins push the content rect and both bands off the paper.                                                                                                             | `PaginationPass.cs:272` | page rect exceeds a 210×297 sheet by 10 mm on every side; both bands entirely off-sheet.                                                                                  |
| U15     | Cells outside the declared tracks are drawn outside the grid and never reported by `ComputeOverflows`.                                                                           | `Grid.cs:147`           | leaves drawn 10 mm below and 30 mm right of the grid box; overflow count reports only a stroke-inflation artefact. Not reachable via `GH_Grid` (it validates).            |
| U16     | `Table.ColumnWidths` silently discarded when shorter than the column count (all-Star fallback).                                                                                  | `Table.cs:399`          | 2 widths for 3 cols → every declared width ignored. `GH_Table.WarnOnCountMismatch` does emit a remark.                                                                    |
| U17–U19 | Duplicates of C13/C14 found independently by a second agent (`DrawingView.cs:73`, `:259`, `:345`) — cross-check their numbers when fixing C13/C14; they add per-scale tables.    | —                       | TextBlockElement: scale 0.02 → 4 emitted as 4, should be 200.                                                                                                             |

---

## Recommended order

**Stage 0 — RESOLVED: fixed forward.** The premise (uncommitted work, so reverting is cheap) was
already false — the 2026-07-27 session is committed as `b754a5cd`. Every regression except the
two that did not reproduce is now fixed forward, and the two structural rewrites Stage 3
predicted were indeed needed. No revert.

**Stage 1 — ✅ DONE (2026-07-28)**, except C7:

1. ✅ C8 `TextFlow.cs:57` — the `+Infinity` cast guard. Cast audit closed: no other instances.
2. ✅ C9 `PaginationPass.cs:110` — empty rect ⇒ 0, not `+Inf`. (Only visible after C8.)
3. ✅ C12 `DrawingView.cs:110` — `FitScale`/`AxisScale`/`IsUsableScale`; `:112`/`:114` guarded.
4. ❌ C7 `Grid.cs:218` — **not reproduced, left alone.** Recover the original probe first.
5. ✅ C14 `DrawingView.cs:365` — `SymbolElement` + `TextBlockElement` arms, scale-qualified Id.

**Stage 2 — ✅ DONE (2026-07-28), all five:**

6. ✅ C2 `DrawingView.cs:109-116` — constrained-but-zero and unconstrained are now distinct
   (`double?`), and the `FitScale` fallback no longer swallows a legitimate zero budget.
7. ✅ C10 `PaginationPass.cs:323` — substitution before layout. Also needed a `TextFlow` arm in
   `TokenResolver.ResolveTree` and a measure→paginate→re-measure loop to break the band-height
   circularity.
8. ✅ C11 `PaginationPass.cs:188` — `max(0, band − margin)` for Margin placement.
9. ✅ C13 `DrawingView.cs:73` — `LayoutPass.Resolve` the geometry subtree before counter-scaling.
10. ✅ U2 — fixed in `ScaleStrokeWidth` (source), not the renderer: a renderer never sees the
    view scale, so only the counter-scale step can tell an authored-visible stroke from a
    genuinely suppressed one.

**Stage 3 — ✅ DONE (2026-07-28)**, as two coordinated changes exactly as advised:

11. ✅ **Stack budget allocation** (C1, C3, U1 — U3 not reproduced): `ShareOf` deleted; children
    measure against the full remaining budget with a proportional correction pass afterwards
    (iterated to convergence, because padding and stroke inflation don't scale); `TrySplit`
    clamps its own context and trusts produced geometry over reported `FitsHeight`.
    The spacing reserve turned out **not** to be involved — see Stage 3 outcome.
12. ✅ **Grid Auto sizing** (C4, C5, C6): `TrackCeiling` = budget − spacing − committed, divided
    among _unknown_ tracks only; `TextFlow` reports `min(ink, effectiveWidth)` while the anchor
    maths keeps the wrap box.

---

## What remains (as of 2026-07-28)

**Re-probe before acting on any of these.** Three of the 33 findings turned out not to reproduce,
and one (C9) only reproduced _after_ an unrelated fix — the register's numbers are leads, not
facts.

1. **C7, U3, U8 — recover the original probes.** All three are documented with specific numbers
   that could not be reproduced. The workflow journal (see Provenance) holds the original
   constructions. Either the probe differed from what the register records or `b754a5cd` already
   fixed them; until that is settled they should not be fixed from these entries.
2. **U4–U19, minus the ones folded in.** U1/U2/U3/U8 are resolved above; U17–U19 were duplicates
   of C13/C14 and are covered by those fixes. That leaves **U4–U7, U9–U16** unexamined — notably
   U5 (caption stapled on outside every budget), U7 (stroke-inflated bounds set the view scale),
   and U4/U12 (the two PDF↔SVG divergences).
3. **`AnchorChrome` no-ops on an empty rect** (`PaginationPass.cs:346`). Surfaced while fixing C9.
   No longer produces off-sheet output now that `availableHeight` is 0, but the anchor arithmetic
   is still skipped rather than handled. Revisit with U9/U14.
4. **The invariant matrix test** — see the first bullet under Test gaps. This is the piece that
   would stop the next container inheriting the same class of bug.

---

## Test gaps that let all of this through

The suite passed 386 tests and caught none of these. It now passes 431; the notes below say which
gaps that closed and which are still open.

- **No invariant test.** _Still open._ Add a matrix test asserting "resolved content never exceeds
  the content rect" across the cross-product of {Stack V/H, Grid Auto/Star/Absolute, Frame, Table,
  TextFlow, bare Group} × {nesting depth 0–2} × {view scale 1, 0.1, 0.02} × {captioned, not}.
  Every container added later then inherits the guarantee instead of the bug. The Stage 2/3 tests
  assert this for the specific shapes that failed, which is not the same as the cross-product —
  this remains the highest-value gap.
- **No `TrySplit` ≡ `Resolve` test.** _Partly closed._ `BudgetAllocationTests` pins that
  `TrySplit` honours its budget whatever context it is handed, and the U3 probe compared
  unpaginated vs paginated geometry directly (they agreed). Still no general assertion that
  paginating a one-page document yields byte-identical geometry to resolving it.
- **No degenerate-input tests.** Zero-extent geometry, empty content rect, `+Infinity` budgets,
  negative margins, zero-size tracks — every one of these produced a defect.
  **Partly closed 2026-07-28**: `Model/Layout/DegenerateInputTests.cs` covers infinite budgets,
  the collapsed content rect, zero-extent and single-axis-flat geometry, and symbol paper-space
  invariance (14 tests; 9 fail against the pre-fix code, the other 5 are paired controls).
  Still uncovered: negative margins (U14) and zero-size tracks.
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
