using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Composes a document from a list of Sections and document-level chrome. Pagination runs
// per-section so each section keeps its own paper / margins / chrome overrides; token
// resolution runs once at the end so {page} / {pages} reflect the global page numbering
// across the entire document, not section-local counts.
//
// Algorithm:
// 1. For each section, compute effective paper / margins / header / footer (section
//    overrides win over document defaults), pre-resolve the chrome tree once, and either
//    paginate its body or — when KeepTogether is set — emit one raw page even if it
//    overflows. Each raw page is tagged with the section context it came from.
// 2. Once every section has been paginated, run TokenResolver per page with the global
//    1..N indices to substitute {page}, {pages}, {section}, {title}, {date}, and any
//    document-level user tokens.
public static class DocumentLayoutPass
{
	public static IReadOnlyList<Page> Paginate(DocumentLayout layout)
	{
		if (layout == null) throw new ArgumentNullException(nameof(layout));

		var sections = layout.Sections ?? Array.Empty<Section>();

		// Pre-resolve doc-level chrome once. Sections that don't override use these.
		var defaultHeader = PaginationPass.ResolveLayout(layout.Header);
		var defaultFooter = PaginationPass.ResolveLayout(layout.Footer);

		var raw = new List<RawPage>();

		// An empty document still emits one chrome-only page so an empty header/footer
		// template renders meaningfully (matches PaginationPass's "null content" behaviour).
		if (sections.Count == 0)
		{
			var paper = layout.PaperSize;
			var margins = layout.Margins;
			var headerH = PaginationPass.ResolveBandHeight(layout.HeaderHeight, defaultHeader);
			var footerH = PaginationPass.ResolveBandHeight(layout.FooterHeight, defaultFooter);
			var body = PaginationPass.PaginateBody(null, paper, margins, headerH, footerH);
			raw.Add(new RawPage
			{
				Paper = paper,
				Margins = margins,
				Title = layout.Title,
				SectionTitle = string.Empty,
				ResolvedHeader = defaultHeader,
				ResolvedFooter = defaultFooter,
				Layout = body,
				ContentIndex = 0,
			});
		}
		else
		{
			foreach (var section in sections)
			{
				if (section == null) continue;

				var paper = section.PaperSize ?? layout.PaperSize;
				var margins = section.Margins ?? layout.Margins;

				var sectionHeader = section.Header != null
					? PaginationPass.ResolveLayout(section.Header)
					: defaultHeader;
				var sectionFooter = section.Footer != null
					? PaginationPass.ResolveLayout(section.Footer)
					: defaultFooter;

				var headerH = PaginationPass.ResolveBandHeight(
					section.HeaderHeight ?? layout.HeaderHeight, sectionHeader);
				var footerH = PaginationPass.ResolveBandHeight(
					section.FooterHeight ?? layout.FooterHeight, sectionFooter);

				// KeepTogether forces the whole section onto one page even if it overflows the
				// content rect. Pagination runs with infinite vertical budget: TrySplit always
				// reports AllFits and we get a single raw page with all the content.
				var body = section.KeepTogether
					? PaginationPass.PaginateBody(section.Content, paper, margins, headerH, footerH, double.PositiveInfinity)
					: PaginationPass.PaginateBody(section.Content, paper, margins, headerH, footerH);

				for (var i = 0; i < body.RawContents.Count; i++)
				{
					raw.Add(new RawPage
					{
						Paper = paper,
						Margins = margins,
						Title = layout.Title,
						SectionTitle = section.Title ?? string.Empty,
						ResolvedHeader = sectionHeader,
						ResolvedFooter = sectionFooter,
						Layout = body,
						ContentIndex = i,
					});
				}
			}
		}

		// Empty doc with non-empty sections list (e.g. all sections null/empty content). Make
		// sure callers always get at least one page out so renderers don't choke.
		if (raw.Count == 0)
		{
			var paper = layout.PaperSize;
			var margins = layout.Margins;
			raw.Add(new RawPage
			{
				Paper = paper,
				Margins = margins,
				Title = layout.Title,
				SectionTitle = string.Empty,
				ResolvedHeader = defaultHeader,
				ResolvedFooter = defaultFooter,
				Layout = PaginationPass.PaginateBody(null, paper, margins, 0, 0),
				ContentIndex = 0,
			});
		}

		var totalPages = raw.Count;
		var now = layout.Now ?? DateTime.Now;
		var pages = new List<Page>(totalPages);

		for (var i = 0; i < totalPages; i++)
		{
			var rp = raw[i];
			var resolver = new TokenResolver(i + 1, totalPages, rp.Title, rp.SectionTitle, layout.Tokens, now);

			var pageHeader = rp.ResolvedHeader != null ? resolver.ResolveTree(rp.ResolvedHeader) : null;
			var pageFooter = rp.ResolvedFooter != null ? resolver.ResolveTree(rp.ResolvedFooter) : null;

			var rawContent = rp.Layout.RawContents[rp.ContentIndex];
			var anchoredContent = PaginationPass.AnchorTopLeft(rawContent, rp.Layout.ContentRect);
			var anchoredHeader = PaginationPass.AnchorTopLeft(pageHeader, rp.Layout.HeaderRect);
			var anchoredFooter = PaginationPass.AnchorTopLeft(pageFooter, rp.Layout.FooterRect);

			pages.Add(new Page
			{
				Size = rp.Paper,
				Margins = rp.Margins,
				Title = string.IsNullOrEmpty(rp.SectionTitle) ? rp.Title : rp.SectionTitle,
				Content = PaginationPass.ComposePage(anchoredHeader, anchoredContent, anchoredFooter),
			});
		}

		return pages;
	}

	private struct RawPage
	{
		public PaperSize Paper;
		public Margins Margins;
		public string Title;
		public string SectionTitle;
		public DrawElement ResolvedHeader;
		public DrawElement ResolvedFooter;
		public SectionLayout Layout;
		public int ContentIndex;
	}
}

// Inputs to DocumentLayoutPass: a list of sections plus document-level defaults and chrome.
// Section overrides (paper, margins, header, footer) win for that section's pages only.
public sealed class DocumentLayout
{
	public IReadOnlyList<Section> Sections { get; init; } = Array.Empty<Section>();

	public string Title { get; init; }

	public PaperSize PaperSize { get; init; } = PaperSize.A4;
	public Margins Margins { get; init; } = Margins.Uniform(10);

	public DrawElement Header { get; init; }
	public DrawElement Footer { get; init; }
	public double? HeaderHeight { get; init; }
	public double? FooterHeight { get; init; }

	// Document-level user tokens. Built-ins (page, pages, section, title, date) win on collision.
	public IReadOnlyDictionary<string, string> Tokens { get; init; }

	// Override the clock, mainly for deterministic tests.
	public DateTime? Now { get; init; }
}
