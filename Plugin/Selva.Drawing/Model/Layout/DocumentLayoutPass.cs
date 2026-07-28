using System;
using System.Collections.Generic;
using System.Globalization;
using Selva.Drawing.Model.Drawings;
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

		var raw = new List<RawPage>();

		foreach (var section in sections)
		{
			if (section == null) continue;

			var paper = section.PaperSize ?? layout.PaperSize;
			var margins = section.Margins ?? layout.Margins;

			// Chrome is measured per section: band height depends on the band width (wrapping
			// TextFlows), and paper/margins — hence the width — can differ per section.
			//
			// Measure the SUBSTITUTED template. Substitution changes text length and layout is
			// what wraps it, so measuring the raw "{title}" reserved a band sized for the token
			// rather than for the value. Cross-section numbering means the true {page}/{pages}
			// aren't known yet; a provisional resolver carrying the real title and section name
			// gets the length-dominant tokens right, and page numbers vary by a digit at most.
			var bandWidth = PaginationPass.BandWidth(paper, margins);
			var measureResolver = new TokenResolver(
				1, 1, layout.Title, section.Title ?? string.Empty, layout.Tokens,
				layout.Now ?? DateTime.Now, layout.Culture);
			var sectionHeader = PaginationPass.ResolveLayout(
				measureResolver.ResolveTree(section.Header ?? layout.Header), bandWidth);
			var sectionFooter = PaginationPass.ResolveLayout(
				measureResolver.ResolveTree(section.Footer ?? layout.Footer), bandWidth);

			var headerH = PaginationPass.ResolveBandHeight(
				section.HeaderHeight ?? layout.HeaderHeight, sectionHeader);
			var footerH = PaginationPass.ResolveBandHeight(
				section.FooterHeight ?? layout.FooterHeight, sectionFooter);

			var headerAlign = section.HeaderAlign ?? layout.HeaderAlign;
			var footerAlign = section.FooterAlign ?? layout.FooterAlign;

			var bands = new BandConfig
			{
				HeaderHeight = headerH,
				FooterHeight = footerH,
				HeaderPlacement = section.HeaderPlacement ?? layout.HeaderPlacement,
				FooterPlacement = section.FooterPlacement ?? layout.FooterPlacement,
				HeaderEdgeOffset = section.HeaderEdgeOffset ?? layout.HeaderEdgeOffset,
				FooterEdgeOffset = section.FooterEdgeOffset ?? layout.FooterEdgeOffset,
			};

			// KeepTogether forces the whole section onto one page even if it overflows the
			// content rect. Pagination runs with infinite vertical budget: TrySplit always
			// reports AllFits and we get a single raw page with all the content.
			var body = section.KeepTogether
				? PaginationPass.PaginateBody(section.Content, paper, margins, bands, double.PositiveInfinity)
				: PaginationPass.PaginateBody(section.Content, paper, margins, bands);

			for (var i = 0; i < body.RawContents.Count; i++)
			{
				raw.Add(new RawPage
				{
					Paper = paper,
					Margins = margins,
					Title = layout.Title,
					SectionTitle = section.Title ?? string.Empty,
					RawHeader = section.Header ?? layout.Header,
					RawFooter = section.Footer ?? layout.Footer,
					HeaderAlign = headerAlign,
					FooterAlign = footerAlign,
					Layout = body,
					ContentIndex = i,
				});
			}
		}

		// An empty document — no sections, or every section null/empty — still emits one
		// chrome-only page (with its bands intact) so an empty header/footer template renders
		// meaningfully and callers always get at least one page out.
		if (raw.Count == 0)
		{
			var paper = layout.PaperSize;
			var margins = layout.Margins;
			var bandWidth = PaginationPass.BandWidth(paper, margins);
			var headerH = PaginationPass.ResolveBandHeight(
				layout.HeaderHeight, PaginationPass.ResolveLayout(layout.Header, bandWidth));
			var footerH = PaginationPass.ResolveBandHeight(
				layout.FooterHeight, PaginationPass.ResolveLayout(layout.Footer, bandWidth));
			var bands = new BandConfig
			{
				HeaderHeight = headerH,
				FooterHeight = footerH,
				HeaderPlacement = layout.HeaderPlacement,
				FooterPlacement = layout.FooterPlacement,
				HeaderEdgeOffset = layout.HeaderEdgeOffset,
				FooterEdgeOffset = layout.FooterEdgeOffset,
			};
			raw.Add(new RawPage
			{
				Paper = paper,
				Margins = margins,
				Title = layout.Title,
				SectionTitle = string.Empty,
				RawHeader = layout.Header,
				RawFooter = layout.Footer,
				HeaderAlign = layout.HeaderAlign,
				FooterAlign = layout.FooterAlign,
				Layout = PaginationPass.PaginateBody(null, paper, margins, bands),
				ContentIndex = 0,
			});
		}

		var totalPages = raw.Count;
		var now = layout.Now ?? DateTime.Now;
		var pages = new List<Page>(totalPages);

		for (var i = 0; i < totalPages; i++)
		{
			var rp = raw[i];

			// Auto-fill {scale} from the views actually placed on this page: one scale → "1:N",
			// several distinct → "As shown" (the drafting convention), none → empty so an unfilled
			// {scale} renders blank rather than leaking the literal token. A doc-level / manual
			// {scale} still wins. Harvested before chrome resolves so the title block's {scale}
			// sees it.
			var tokens = MergeScaleToken(layout.Tokens, HarvestScaleLabel(rp.Layout.RawContents[rp.ContentIndex]) ?? string.Empty);
			var resolver = new TokenResolver(i + 1, totalPages, rp.Title, rp.SectionTitle, tokens, now, layout.Culture);

			// Chrome resolves per page: this page's tokens substitute into the raw template
			// first, then the result is laid out against the band rect (so star grids fill the
			// band width and TextFlows wrap the substituted text, not the token).
			var pageHeader = PaginationPass.ResolveChromeForPage(rp.RawHeader, rp.Layout.HeaderRect, resolver);
			var pageFooter = PaginationPass.ResolveChromeForPage(rp.RawFooter, rp.Layout.FooterRect, resolver);

			// Body text gets the same substitution so tokens work outside chrome too.
			var rawContent = resolver.ResolveTree(rp.Layout.RawContents[rp.ContentIndex]);
			var anchoredContent = PaginationPass.AnchorTopLeft(rawContent, rp.Layout.ContentRect);
			var anchoredHeader = PaginationPass.AnchorChrome(pageHeader, rp.Layout.HeaderRect, rp.HeaderAlign);
			var anchoredFooter = PaginationPass.AnchorChrome(
				pageFooter, rp.Layout.FooterRect, rp.FooterAlign, PaginationPass.VerticalAnchor.Bottom);

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

	// Returns the {scale} label for a resolved page body: the shared "1:N" ratio when every
	// view drew at one scale, "As shown" when they differ, or null when no view stamped a scale
	// (so the doc-level token / manual value wins). Distinct scales are compared on the rounded
	// label so 1:4.999 and 1:5 don't read as divergent.
	private static string HarvestScaleLabel(DrawElement body)
	{
		var labels = new HashSet<string>(StringComparer.Ordinal);
		CollectScaleLabels(body, labels);
		if (labels.Count == 0) return null;
		if (labels.Count == 1)
		{
			var only = default(string);
			foreach (var l in labels) only = l;
			return only;
		}
		return "As shown";
	}

	private static void CollectScaleLabels(DrawElement element, HashSet<string> labels)
	{
		if (element == null) return;
		if (element.Metadata != null
			&& element.Metadata.TryGetValue(DrawingView.ScaleMetadataKey, out var raw)
			&& double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var scale)
			&& scale > 0)
		{
			labels.Add(FormatRatio(scale));
		}
		if (element is GroupElement g)
			foreach (var c in g.Children) CollectScaleLabels(c, labels);
	}

	// Bare "1:N" / "N:1" ratio for a title-block field (no "SCALE " prefix).
	private static string FormatRatio(double scale)
	{
		if (Math.Abs(scale - 1.0) < 1e-9) return "1:1";
		if (scale < 1.0) return $"1:{FormatNumber(1.0 / scale)}";
		return $"{FormatNumber(scale)}:1";
	}

	private static string FormatNumber(double n)
	{
		if (Math.Abs(n - Math.Round(n)) < 1e-6) return ((int)Math.Round(n)).ToString(CultureInfo.InvariantCulture);
		return n.ToString("0.##", CultureInfo.InvariantCulture);
	}

	private static IReadOnlyDictionary<string, string> MergeScaleToken(
		IReadOnlyDictionary<string, string> tokens, string scaleLabel)
	{
		// Defensive: a null label means "don't touch tokens". Callers pass "" to render blank.
		if (scaleLabel == null) return tokens;
		var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
		if (tokens != null)
			foreach (var kv in tokens) map[kv.Key] = kv.Value;
		// Only auto-fill when the document didn't already define {scale} explicitly — an explicit
		// project value is intentional and shouldn't be overwritten by inference. Defining it as
		// empty when nothing is inferred means an unfilled {scale} renders blank, not as "{scale}".
		if (!map.ContainsKey("scale")) map["scale"] = scaleLabel;
		return map;
	}

	private struct RawPage
	{
		public PaperSize Paper;
		public Margins Margins;
		public string Title;
		public string SectionTitle;
		public DrawElement RawHeader;
		public DrawElement RawFooter;
		public HorizontalAlign HeaderAlign;
		public HorizontalAlign FooterAlign;
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

	public HorizontalAlign HeaderAlign { get; init; } = HorizontalAlign.Left;
	public HorizontalAlign FooterAlign { get; init; } = HorizontalAlign.Left;

	public ChromePlacement HeaderPlacement { get; init; } = ChromePlacement.Margin;
	public ChromePlacement FooterPlacement { get; init; } = ChromePlacement.Margin;

	public double HeaderEdgeOffset { get; init; }
	public double FooterEdgeOffset { get; init; }

	// Document-level user tokens. Built-ins (page, pages, section, title, date) win on collision.
	public IReadOnlyDictionary<string, string> Tokens { get; init; }

	// Override the clock, mainly for deterministic tests.
	public DateTime? Now { get; init; }

	// Culture used to format the {date} token's localized parts (month/day names). Null →
	// invariant (English). Numeric date formats (dd.MM.yyyy) are unaffected by culture.
	public System.Globalization.CultureInfo Culture { get; init; }
}
