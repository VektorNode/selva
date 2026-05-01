# Page Flow / Auto-Pagination Plan

**Status:** Proposed
**Last updated:** 2026-05-01
**Owner:** Felix

## Goal

Make multi-page PDF/SVG output a one-component operation. Today users have to
build each `Page` by hand and manually decide what fits where. After this work,
they hand a list of elements to `GH_PageFlow`, get back a list of `Page`s with
content automatically split across as many pages as needed, with optional
header/footer templates and built-in tokens for page numbers, dates, and titles.

Headline use cases:
- BOM/parts table that spans 4 pages, header row repeating on each.
- Drawing set where every sheet shares the same title block + page numbering.
- Long report where stacked sections break naturally between pages.

## Non-goals (v1)

- "Keep with next" / orphan-control hints (Phase 4).
- Repeating non-table content (e.g. "section header repeats while inside section").
- Column flow within a single page (newspaper layout).
- Custom token formatters beyond date format strings.
- Splitting Frame/Grid/TextFlow internally — they stay atomic in v1.

## Architecture

### Where pagination lives

Add a new pass alongside `LayoutPass` in [`Plugin/Selva.Drawing/Model/Layout/`](../../Plugin/Selva.Drawing/Model/Layout/):

```
PaginationPass.Paginate(content, template) → IReadOnlyList<Page>
```

Reasons:
- A pagination operation is fundamentally many-pages-out, which doesn't fit
  `LayoutElement.Resolve(context) → DrawElement`.
- Keeps the existing `LayoutElement` contract intact — every element still
  resolves to a single subtree per page.
- Renderers don't change. Each emitted page is a normal `Page` and goes
  through `LayoutPass` like any other.

### The split contract

Add to [`LayoutElement`](../../Plugin/Selva.Drawing/Model/Layout/LayoutElement.cs):

```csharp
public abstract class LayoutElement : DrawElement
{
    // existing: Accept, Resolve, ComputeBounds ...

    // Try to split this element so the part that fits in `availableHeight`
    // is returned as `Fits`, and what remains is returned as `Overflow`.
    //
    // Default: atomic — fits whole or not at all.
    //   - natural height ≤ availableHeight  → (this, null)
    //   - otherwise                          → (null, this)
    //
    // The non-LayoutElement primitives (PathElement, TextElement, ImageElement,
    // DimensionElement, LeaderElement, HatchElement, SymbolElement, GroupElement)
    // are wrapped through a helper that treats them the same way.
    public virtual SplitResult TrySplit(double availableHeight, LayoutContext context)
        => SplitResult.Atomic(this, ComputeBounds().Height, availableHeight);
}

public readonly struct SplitResult
{
    public DrawElement Fits { get; }       // null = nothing fits on current page
    public DrawElement Overflow { get; }   // null = fully placed
    public double FitsHeight { get; }      // height the placed part actually consumes

    public static SplitResult All(DrawElement e, double h)        => new(e, null, h);
    public static SplitResult None(DrawElement e)                 => new(null, e, 0);
    public static SplitResult Some(DrawElement fits, DrawElement overflow, double h)
                                                                  => new(fits, overflow, h);
}
```

GroupElement wrapping non-LayoutElements is treated atomically by a helper:
`SplitResult.AtomicElement(DrawElement, availableHeight)` — measures
`ComputeBounds().Height` and returns All or None.

### Per-primitive split behavior (v1)

| Element | Behavior |
| --- | --- |
| `Stack` (vertical) | Splits **between children**. Walks children top-down, accumulating height; on the first child that doesn't fit, recurses into `child.TrySplit(remainingHeight)`. Children before split go to `Fits`; the split child's overflow + remaining children go to `Overflow`. |
| `Stack` (horizontal) | Atomic. Horizontal stacks are usually small (rows of buttons / a title row); vertical pagination of horizontal layouts is rare and easy to add later. |
| `Table` | Splits **between rows**. Header row is cloned into the overflow Table so it repeats on the next page. Borders re-rendered automatically because they're computed inside `Table.Resolve`. (Phase 3 — see Phasing below.) |
| `Frame` | Atomic in v1. Splitting a frame would require splitting its child and re-flowing the border, which is out of scope. |
| `Grid` | Atomic. Same reason as Frame. Grids are usually fixed-size title blocks anyway. |
| `TextFlow` | Atomic in v1. Phase-2 candidate: split at line boundaries — already line-based internally. |
| `GroupElement` | Atomic — measured by bounds. (Stacks are the splittable container; Groups are for transforms.) |
| Primitives (`PathElement` etc.) | Atomic. |

### Page templates and tokens

```csharp
public sealed class PageTemplate
{
    public PaperSize Size { get; init; } = PaperSize.A4;
    public Margins Margins { get; init; } = Margins.Uniform(10);
    public string Title { get; init; }

    // Drawn once per page. Their bounding boxes determine how much vertical
    // space they consume; PaginationPass subtracts that from the content rect.
    public DrawElement Header { get; init; }
    public DrawElement Footer { get; init; }

    // Optional explicit reserved heights — overrides natural bounds. Useful when
    // the header has dynamic content that grows by a known maximum.
    public double? HeaderHeight { get; init; }
    public double? FooterHeight { get; init; }

    // User-defined tokens. Built-in tokens always win on a name collision.
    public IReadOnlyDictionary<string, string> Tokens { get; init; }
}
```

Built-in tokens (resolved at pagination time):

| Token | Substitution |
| --- | --- |
| `{page}` | 1-based page number |
| `{pages}` | Total pages |
| `{date}` | Local date, ISO format `2026-05-01` |
| `{date:fmt}` | `DateTime.Now.ToString(fmt)`, e.g. `{date:dd MMM yyyy}` |
| `{title}` | `PageTemplate.Title` (or empty) |
| `{name}` | User-supplied via `Tokens` (fall-through for any unknown token) |

Substitution algorithm:
- Walk the header/footer subtree. For each `TextElement` and `TextBlockElement`,
  replace tokens in the `Text` string with a deep-clone of the element. This
  keeps the originals usable across pages without aliasing.
- Walk happens once per page so `{page}` resolves to the current page.

A small `TokenResolver` class owns the regex (`\{([a-z]+)(?::([^}]+))?\}`) and
the substitution table. Lives next to `PaginationPass`.

### PaginationPass algorithm

```
input:  content (typically a vertical Stack of "blocks"), template, total-pages-callback?
output: list<Page>

1. Compute pageRect from PaperSize - margins.
2. Compute headerHeight, footerHeight (explicit or measured).
3. contentRect = pageRect.shrink(top: headerHeight, bottom: footerHeight)
4. Treat content as a queue. If it's a vertical Stack, the queue is its children;
   otherwise it's a single-element queue with the whole content.
5. For pageIndex = 1, 2, ...
   a. Take elements off the queue, fitting them into a fresh vertical Stack
      anchored at contentRect's top-left, until the next element doesn't fit.
   b. On overflow, call element.TrySplit(remainingHeight). If `Fits` is non-null,
      append it; push `Overflow` back to the front of the queue.
   c. If nothing fit on this page (e.g. an atomic 300mm element on an A4 page),
      emit a warning and place it whole — guarantees forward progress.
   d. Build the page: Header (with tokens) + content stack + Footer (with tokens).
   e. Stop when the queue is empty.
6. Two-pass for {pages}: run steps 4–5 once with `{pages}` left as a placeholder,
   count the result, then run again with the count substituted. (Or: substitute
   token strings post-hoc in the resolved tree — cheaper, see Optimization below.)
```

**Optimization for `{pages}`:** since `{pages}` doesn't affect layout (substituting
"4" for "{pages}" doesn't change line breaks beyond a few mm), we resolve it as a
post-process string replace on the already-built pages instead of running layout
twice. We accept the small visual cost; if it becomes a problem later, we promote
to two-pass.

### GH component shape

`GH_PageFlow` in `Plugin/Selva.GH/Features/Drawing/Components/GH_PageFlow.cs`:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `Content` | list of DrawElement | — | Flowed top-to-bottom |
| `Paper Size` | int (named values) | A4 | Same enum as GH_Page |
| `Landscape` | bool | false | |
| `Margin` | number | 10 | Uniform mm |
| `Header` | DrawElement (item) | null | Optional |
| `Footer` | DrawElement (item) | null | Optional |
| `Header Height` | number | 0 (auto) | mm; 0 → measured |
| `Footer Height` | number | 0 (auto) | mm |
| `Title` | text | "" | Becomes `{title}` and Page.Title |
| `Token Keys` | list of text | [] | User token names |
| `Token Values` | list of text | [] | Parallel list — substituted as `{key}` |
| **Output: Pages** | list of Page | | Plug straight into GH_Document |

Component lives in `category: Selva, subcategory: Document` next to
`GH_Page`/`GH_Document`. Exposure: `primary` — this is a headliner.

Preview: same as `GH_Page` — when one Page is selected we draw it. For a list of
pages, draw them tiled left-to-right with a small gap so the user can see the
whole document at once.

### File layout

New files:
```
Plugin/Selva.Drawing/Model/Layout/
  PaginationPass.cs           — main algorithm
  PageTemplate.cs             — record
  TokenResolver.cs            — regex + substitution
  SplitResult.cs              — readonly struct

Plugin/Selva.GH/Features/Drawing/Components/
  GH_PageFlow.cs              — Grasshopper component
```

Modified:
```
Plugin/Selva.Drawing/Model/Layout/LayoutElement.cs    — add TrySplit virtual
Plugin/Selva.Drawing/Model/Layout/Stack.cs            — override TrySplit
Plugin/Selva.Drawing/Model/Layout/Table.cs            — override TrySplit (Phase 3)
```

New tests in `Plugin/Selva.Drawing.Tests/Model/Layout/`:
```
PaginationPassTests.cs        — golden-path multi-page splits
TokenResolverTests.cs         — built-in + user token substitution
StackSplitTests.cs            — split at child boundaries
TableSplitTests.cs            — header repeats, row splits (Phase 3)
```

## Phasing

Each phase ships independently and adds visible value.

### Phase 1 — Skeleton + Stack splitting

- `SplitResult` struct, `LayoutElement.TrySplit` virtual with atomic default.
- `Stack.TrySplit` for vertical stacks.
- `PaginationPass.Paginate(content, paperSize, margins)` — no header/footer/tokens.
- `GH_PageFlow` with the basic inputs (Content, Paper Size, Landscape, Margin)
  and Pages output.

After phase 1: a long Stack of paragraphs auto-flows across N pages.

### Phase 2 — Templates + built-in tokens

- `PageTemplate` record.
- `TokenResolver` with `{page}`, `{pages}`, `{date}`, `{date:fmt}`, `{title}`.
- Header/Footer/HeaderHeight/FooterHeight/Title inputs on `GH_PageFlow`.

After phase 2: every page has a title block + page number + date.

### Phase 3 — Table row splitting

- `Table.TrySplit` — split between rows, clone Header into overflow.
- Tests for: table with no header, table with header, table where the header
  itself doesn't fit (warning + place whole on its own page).

After phase 3: a 200-row BOM table flows naturally across pages, header repeats.

### Phase 4 — User tokens + nice-to-haves

- Token Keys / Token Values inputs on `GH_PageFlow`.
- `TextFlow.TrySplit` (line-boundary splits).
- "Keep with next" hint on `GroupElement` metadata (paginator treats group as atomic if set).
- Tile-preview for page lists.

## Risks and tradeoffs

- **`TrySplit` is a contract every future LayoutElement must consider.** Default
  is safe (atomic), but anyone adding a new layout primitive needs to think
  about whether splitting is meaningful. Worth a one-line note in
  `LayoutElement.cs`.
- **Cloning subtrees per page** to substitute tokens has a cost. Mitigated by
  only deep-cloning the elements that contain tokens (we can detect the brace
  pattern cheaply on the way in).
- **Two-pass `{pages}` vs post-hoc string replace.** Going with post-hoc; if line
  breaks shift visibly with multi-digit page counts, switch to two-pass.
- **Forward progress guarantee.** If a single atomic element is taller than the
  content rect, we place it whole and warn — better than an infinite loop or a
  silently dropped element.
- **Backward compatibility.** Adding a virtual with a default doesn't break
  existing code. `GH_Page` is unaffected.
- **Preview behavior for a list of pages.** Tiled preview is nice but not load-
  bearing — fall back to "show the first page" if it gets noisy.

## Out-of-scope follow-ups (worth noting)

- **Auto-fit interplay.** The renderers have an auto-fit mode that overrides
  paper size to content bounds. Auto-fit + multi-page is contradictory; document
  that PageFlow always uses the explicit paper size.
- **Drawing-view scaling per page.** A drawing that doesn't fit at 1:1 should
  scale to fit — out of scope here, belongs in `GH_DrawingView`.
- **Section headers that repeat while inside a section.** Real but complex; user
  workaround is to start each section with its own `GH_PageFlow` and concat the
  resulting page lists.
