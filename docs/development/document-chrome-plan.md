# Document-Owned Chrome Refactor

**Status:** Proposed
**Last updated:** 2026-05-01
**Owner:** Felix

## Goal

Move header, footer, and tokens from `GH_PageFlow` up to `GH_Document` so page
numbering is correct across a document assembled from multiple sections, and so
chrome is defined once where it logically belongs (the document, not the
section). Collapse `GH_Page` and `GH_PageFlow` into a single smarter `GH_Page`
that always paginates — emitting one page when content fits, N when it doesn't.

Headline use cases that work after this:

- Document assembled from a cover Page, a 4-page BOM Page, a 12-page report
  Page → footer reads `Page 1 of 17` … `Page 17 of 17` end-to-end.
- Drawing set where every sheet shares one title block defined once on the
  document, not redefined on each section.
- A `{section}` token in the title block that updates per page based on which
  Section that page came from.

## Non-goals

- Multiple document-level templates (e.g. "this document uses two title blocks
  alternating per side"). Keep one Header / one Footer at the document level.
- Section-level overrides for Tokens — section-supplied user tokens collide
  with document-level user tokens in confusing ways. User tokens are
  document-wide.
- Reflowing content across section boundaries — sections stay independent
  pagination units. A row that doesn't fit at the end of section A doesn't
  spill into section B.

## Architecture

### The new shape

```
Section { Content, PaperSize?, Margins?, Title, KeepTogether?, Header?, Footer? }
              ↓
Document { Sections, Header, Footer, Title, PaperSize, Margins,
           HeaderHeight?, FooterHeight?, Tokens, Metadata }
              ↓
        Pages[]   ← rendered pages, page numbering global
```

A `Section` is an unrendered description: content tree plus optional paper /
margins / per-section header overrides. It does *not* know its page numbers.

`Document` owns the pagination + token resolution pass. It walks each section,
runs `PaginationPass` to break content into raw page contents, concatenates
them, then runs token resolution **once** with global page counts.

### Algorithm

```
input:  document with sections, header/footer template, tokens
output: list<Page>

1. Resolve doc Header/Footer once (geometry doesn't change across pages).
2. Measure header/footer band heights (explicit or measured from bounds).
3. raw = []  // list of (sectionIndex, sectionTitle, paperSize, margins, content, headerOverride, footerOverride)
4. For each section s:
   a. paper = s.PaperSize ?? doc.PaperSize
   b. margins = s.Margins ?? doc.Margins
   c. effectiveHeader = s.Header ?? doc.Header
   d. effectiveFooter = s.Footer ?? doc.Footer
   e. Compute content rect from paper - margins - reservedHeader - reservedFooter
   f. Use existing PaginationPass internals (TrySplit loop) to produce raw page
      contents for s.Content — but DON'T compose chrome, DON'T resolve tokens.
   g. For each raw page, push (s.Index, s.Title, paper, margins, content,
      effectiveHeader, effectiveFooter) onto `raw`.
5. totalPages = raw.Count
6. For pageIndex 1..totalPages
   a. resolver = TokenResolver(pageIndex, totalPages, doc.Title,
                                section: raw[i].sectionTitle,
                                doc.Tokens, now)
   b. pageHeader = resolver.ResolveTree(raw[i].header)  // tokens swap here
   c. pageFooter = resolver.ResolveTree(raw[i].footer)
   d. Anchor header to top band, footer to bottom band, content to middle,
      compose into a Page.
7. Return composed pages.
```

The key change vs. today: pagination and token resolution split into two
passes. Pagination produces "raw" page contents tagged with section context;
token resolution runs at the end when the global count is known.

### `TokenResolver` extension

Tokens stay the single substitution mechanism for everything dynamic in
chrome — no first-class `PageNumberElement` parallel track. One mental model:
write `{page}`, `{pages}`, `{section}`, `{date}`, `{title}`, or any user-
supplied `{name}` inside any `TextElement` / `TextBlockElement` and it
resolves at final composition.

Add a `section` argument and the `{section}` built-in:

| Token | Substitution |
| --- | --- |
| `{page}` | Global 1-based page number (across all sections) |
| `{pages}` | Global total pages |
| `{section}` | Current page's section title (or empty) |
| `{date}` / `{date:fmt}` / `{title}` | Unchanged |
| User tokens | Unchanged — still document-level only |

Built-ins still win on collision.

Because resolution now runs *after* all sections are paginated and
concatenated, the post-hoc string-replace optimization for `{pages}` goes
away — the count is known when the resolver runs. Cleaner.

### Sections, not Pages

Rename what `GH_Page` outputs from `Page` → `Section`. The `Page` type stays
where it is — it's the *rendered* output of the pagination pass, what
renderers consume. Today's `Page` and the new `Section` collide visually but
serve different roles:

- `Section` (input to Document): unrendered, has `Content` + paper/margin
  hints. Section.PaperSize is optional because Document supplies a default.
- `Page` (output of Document): rendered, has `Content` (composed with chrome)
  + final paper size + final margins + Title.

### GH component shape

**`GH_Page`** (renamed concept; unchanged ComponentGuid so existing files keep
working — this is pre-release so we could break, but cheap to keep). Outputs a
`Section`.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `Content` | list of DrawElement | — | Becomes the section body |
| `Title` | text | "" | Section title; surfaces via `{section}` token and on each output Page |
| `Paper Size` | int | inherit | When unset, Document's paper size wins |
| `Landscape` | bool | inherit | Same |
| `Margin` | number | inherit (-1 sentinel) | mm |
| `Header` | DrawElement | null | Optional override of doc header |
| `Footer` | DrawElement | null | Optional override of doc footer |
| `Keep Together` | bool | false | Whole section forced onto one page (force-place) |
| **Output: Section** | Section | | Plug into GH_Document |

**`GH_Document`** picks up everything `GH_PageFlow` had except the per-section
fields.

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `Sections` | list of Section | — | In order |
| `Title` | text | "" | Document title; metadata + `{title}` token |
| `Author` / `Subject` / `Keywords` | unchanged | | |
| `Paper Size` | int | A4 | Default for sections |
| `Landscape` | bool | false | Default |
| `Margin` | number | 10 | Default mm |
| `Header` | DrawElement | null | Drawn on every page that doesn't override |
| `Footer` | DrawElement | null | Same |
| `Header Height` | number | 0 (auto) | mm |
| `Footer Height` | number | 0 (auto) | mm |
| `Token Keys` / `Token Values` | text lists | [] | Document-level user tokens |
| **Output: Document** | Document | | Plugs into renderers |

**`GH_PageFlow` is removed.** Its job is now split between `GH_Page` (which
always paginates internally) and `GH_Document` (which owns chrome).

### File layout

New files:
```
Plugin/Selva.Drawing/Model/Layout/
  Section.cs          — record: unrendered section description
  DocumentLayoutPass.cs   — orchestrates per-section pagination + global token resolve
```

Modified:
```
Plugin/Selva.Drawing/Model/Layout/PaginationPass.cs
  - Refactor: extract a "paginate body only" entry point that returns raw page
    contents + reserved chrome bands. Existing single-template entry point
    becomes a thin wrapper for backwards compat (used in tests).
Plugin/Selva.Drawing/Model/Layout/TokenResolver.cs
  - Add `section` parameter and `{section}` built-in.
Plugin/Selva.Drawing/Model/Document.cs
  - Optionally store Header/Footer/Tokens on Document for renderers, OR keep
    them only at the GH-component layer. Decide during implementation.
Plugin/Selva.GH/Features/Drawing/Components/GH_Page.cs
  - Output a Section. Inputs as above.
Plugin/Selva.GH/Features/Drawing/Components/GH_Document.cs
  - Take Sections + chrome + tokens. Run DocumentLayoutPass.
```

Deleted:
```
Plugin/Selva.GH/Features/Drawing/Components/GH_PageFlow.cs
```

### Tests

New / updated:
```
Plugin/Selva.Drawing.Tests/Model/Layout/
  DocumentLayoutPassTests.cs    — global page numbering across sections
  SectionTests.cs               — section paper/margin inheritance
  PaginationPassTests.cs        — keep, but adjust to new entry point
  PaginationTemplateTests.cs    — keep, ditto
  TokenResolverTests.cs         — add {section} cases
```

Key new assertions:

- Two sections of 2 + 3 pages → footer reads "1/5" through "5/5".
- `{section}` resolves to the current page's section title.
- Section.Header overrides Document.Header for that section's pages, but the
  rest of the document keeps Document.Header.
- Section with `KeepTogether = true` whose content overflows still emits one
  page (force-place + warning).
- A section with `PaperSize = null` inherits Document.PaperSize.

## Phasing

**Single hard-break PR.** Pre-release means there's no deprecation cost; a
phased rollout would just leave half-finished plumbing in trunk. Land it all
at once: new `Section` record, rewritten `GH_Page` and `GH_Document`,
`GH_PageFlow` deleted, tests rewritten to the new entry points, examples
updated.

## Risks and tradeoffs

- **Breaking refactor.** Pre-release means free, but every example file /
  screenshot in docs has to be redone. Cheaper now than after first release.
- **Pagination has to know about chrome height before token resolution
  finishes.** Already true today (chrome bounds are measured before the per-page
  resolve). Confirms the existing geometry-vs-text split works for this.
- **Two-pass token resolution is one extra walk over the page tree.** Clones
  only the TextElement / TextBlockElement nodes that contain braces (existing
  behavior) so the cost is bounded by the number of token-bearing strings, not
  the size of the page.
- **`{pages}` becomes naturally correct** — no more post-hoc string-replace
  optimization. The resolver now runs after totals are known. Slight win.
- **Section overrides add a fallthrough rule** (`Section.Header ?? Document.Header`).
  Worth a one-line note in the component help.
- **What if a section is empty?** Decision: emit zero pages for that section
  (current PaginationPass-with-null-content semantics produce one page with
  chrome-only; we keep that for empty *Document*, not empty Section).
- **PageFlow loyalists.** None — pre-release.

## Out-of-scope follow-ups

- **Per-section page-numbering scheme** (Roman for front matter, Arabic for
  body, restart at chapter). Real, but adds a `NumberingStyle` enum on
  Section. File for a follow-up if anyone asks.
- **Cross-references** (`{ref:bom}` → "Page 7"). Composes well on top of this:
  Document now owns the global token pass, so a named-anchor pre-pass slots in
  cleanly. Worth doing right after this refactor lands.
- **Custom Page object models** for renderers that want to add their own
  per-page chrome at render time (watermarks, draft stamps). Skip for v1.
