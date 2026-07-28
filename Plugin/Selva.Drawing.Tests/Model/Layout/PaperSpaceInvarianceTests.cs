using System.Collections.Generic;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

// Stage 2 regressions from the 2026-07-27 layout audit. Three themes:
//   * a view must honour a container budget that is finite-but-exhausted (C2),
//   * paper-space styles must survive the view transform wherever they sit in the tree, and at
//     enlargement scales as well as reductions (C13, U2),
//   * chrome must not overprint the body, and token text must be laid out after substitution
//     (C11, C10).
public class PaperSpaceInvarianceTests
{
	// ========================================================================================
	// C2 — an exhausted budget is a limit, not an invitation
	// ========================================================================================

	[Fact]
	public void Horizontal_stack_of_auto_fit_views_stays_inside_the_content_rect()
	{
		// A horizontal Stack is atomic to pagination, so nothing downstream rescues an overflow.
		// The second view used to see a spent (0) main axis, read it as "unconstrained", and fit
		// to width with no height limit — producing a 3789mm-wide page.
		var stack = new Stack
		{
			Orientation = StackOrientation.Horizontal,
			Children = new DrawElement[]
			{
				new DrawingView { Geometry = Geometry(400, 30) },
				new DrawingView { Geometry = Geometry(400, 30) },
			},
		};

		var bounds = stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Width <= 190.001, $"stack is {bounds.Width:F2}mm wide on a 190mm rect");
	}

	[Fact]
	public void Vertical_stack_of_auto_fit_views_stays_inside_the_content_rect()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[]
			{
				new DrawingView { Geometry = Geometry(400, 300) },
				new DrawingView { Geometry = Geometry(400, 300) },
			},
		};

		var bounds = stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Height <= 277.001, $"stack is {bounds.Height:F2}mm tall on a 277mm rect");
	}

	[Fact]
	public void A_view_given_a_tiny_budget_does_not_size_itself_freely()
	{
		// The trigger is 0 <= remaining <= paddingSum, not exactly 0. A 1mm budget used to
		// produce a 1106mm view.
		var view = new DrawingView { Geometry = Geometry(400, 30), Padding = Margins.Zero };

		var bounds = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 1))).ComputeBounds();

		Assert.True(bounds.Height <= 1.001, $"view is {bounds.Height:F2}mm tall in a 1mm budget");
	}

	// ========================================================================================
	// C13 — counter-scaling must reach layout elements below the root of Geometry
	// ========================================================================================

	[Fact]
	public void Layout_element_nested_below_the_geometry_root_is_counter_scaled()
	{
		// Only a LayoutElement at the ROOT of Geometry was pre-resolved. One level down, inside
		// a GroupElement, it survived counter-scaling untouched and expanded later in LayoutPass
		// — after the styles it carried should have been scaled. Error is 1/Scale, unbounded.
		var nested = new DrawingView
		{
			Geometry = new GroupElement { Children = new DrawElement[] { BorderedFrame() } },
			Scale = 0.1,
		};

		var widths = StrokeWidths(nested.Resolve(new LayoutContext(BoundingBox.Empty)));

		Assert.Contains(7.0, widths);
	}

	[Fact]
	public void Nested_and_root_layout_geometry_counter_scale_identically()
	{
		var root = new DrawingView { Geometry = BorderedFrame(), Scale = 0.1 };
		var nested = new DrawingView
		{
			Geometry = new GroupElement { Children = new DrawElement[] { BorderedFrame() } },
			Scale = 0.1,
		};

		Assert.Equal(
			StrokeWidths(root.Resolve(new LayoutContext(BoundingBox.Empty))),
			StrokeWidths(nested.Resolve(new LayoutContext(BoundingBox.Empty))));
	}

	// ========================================================================================
	// U2 — enlargement views must keep their linework
	// ========================================================================================

	[Theory]
	[InlineData(0.13)]
	[InlineData(0.25)]
	[InlineData(0.5)]
	public void Standard_line_weights_survive_enlargement_scales(double authoredWidth)
	{
		// MinVisibleWidthMm is a threshold about the printed sheet, but it is tested against the
		// counter-scaled local width. At 50:1 every standard weight fell under it and both
		// renderers skipped the stroke — a detail view exported as a blank page.
		foreach (var scale in new[] { 20.0, 25.0, 50.0 })
		{
			var view = new DrawingView
			{
				Geometry = new PathElement
				{
					Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 0).LineTo(10, 10).Close().Build(),
					Stroke = new Stroke { Width = authoredWidth },
				},
				Scale = scale,
			};

			var resolved = view.Resolve(new LayoutContext(BoundingBox.Empty));

			foreach (var stroke in Strokes(resolved))
				Assert.True(stroke.IsVisible,
					$"authored {authoredWidth}mm at {scale}:1 scaled to {stroke.Width} and would not be drawn");
		}
	}

	[Fact]
	public void A_deliberately_suppressed_stroke_stays_suppressed_at_every_scale()
	{
		// Width 0 means "no stroke" and must not be rescued by the visibility floor.
		foreach (var scale in new[] { 0.02, 1.0, 50.0 })
		{
			var view = new DrawingView
			{
				Geometry = new PathElement
				{
					Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 10).Build(),
					Stroke = new Stroke { Width = 0 },
				},
				Scale = scale,
			};

			foreach (var stroke in Strokes(view.Resolve(new LayoutContext(BoundingBox.Empty))))
				Assert.False(stroke.IsVisible, $"suppressed stroke became visible at scale {scale}");
		}
	}

	// ========================================================================================
	// C11 — a Margin-placed band must not overprint the body
	// ========================================================================================

	[Fact]
	public void Margin_placed_header_taller_than_the_margin_does_not_overlap_the_body()
	{
		// This is the DEFAULT config: Margin placement plus a null HeaderHeight (auto-measure).
		// ContentReserve returned 0 for Margin while the band was anchored at the paper edge, so
		// a 40mm header overlapped 30mm of body with no clip in either renderer.
		var bands = new BandConfig
		{
			HeaderHeight = 40,
			HeaderPlacement = ChromePlacement.Margin,
		};

		var section = PaginationPass.PaginateBody(Rect(100, 200), PaperSize.A4, Margins.Uniform(10), bands);

		Assert.Equal(0, VerticalOverlap(section.HeaderRect, section.ContentRect), 3);
	}

	[Fact]
	public void Margin_and_edge_placement_reserve_the_same_body_when_the_bands_coincide()
	{
		// Margin and Edge(EdgeOffset=0) produce the identical band rect, so they must shrink the
		// body identically too. Only Edge used to.
		var margin = PaginationPass.PaginateBody(Rect(100, 200), PaperSize.A4, Margins.Uniform(10),
			new BandConfig { HeaderHeight = 40, HeaderPlacement = ChromePlacement.Margin });
		var edge = PaginationPass.PaginateBody(Rect(100, 200), PaperSize.A4, Margins.Uniform(10),
			new BandConfig { HeaderHeight = 40, HeaderPlacement = ChromePlacement.Edge, HeaderEdgeOffset = 0 });

		Assert.Equal(edge.HeaderRect.MinY, margin.HeaderRect.MinY, 3);
		Assert.Equal(edge.ContentRect.MaxY, margin.ContentRect.MaxY, 3);
	}

	[Fact]
	public void A_band_that_fits_within_the_margin_still_costs_the_body_nothing()
	{
		// The point of Margin placement: a band smaller than the margin gap is free.
		var section = PaginationPass.PaginateBody(Rect(100, 200), PaperSize.A4, Margins.Uniform(20),
			new BandConfig { HeaderHeight = 15, HeaderPlacement = ChromePlacement.Margin });
		var none = PaginationPass.PaginateBody(Rect(100, 200), PaperSize.A4, Margins.Uniform(20),
			new BandConfig());

		Assert.Equal(none.ContentRect.MaxY, section.ContentRect.MaxY, 3);
	}

	// ========================================================================================
	// C10 — tokens must be substituted before layout, not after
	// ========================================================================================

	[Fact]
	public void A_token_that_expands_is_wrapped_like_the_literal_it_becomes()
	{
		// LayoutPass ran before substitution, so a header TextFlow wrapped the literal "{title}"
		// and the real value was never line-broken or re-measured — one run advancing 562mm on a
		// 210mm sheet, with bounds still reporting the stale wrap box so no overflow check saw it.
		const string title = "A VERY LONG DRAWING TITLE THAT WILL NOT FIT IN THE MEASURED BAND AT ALL";

		var tokenised = DocumentLayoutPass.Paginate(new DocumentLayout
		{
			Title = title,
			Header = new TextFlow { Text = "{title}", Style = new TextStyle { FontSize = 5 } },
			Sections = new[] { new Section { Content = Rect(100, 100) } },
		});
		var literal = DocumentLayoutPass.Paginate(new DocumentLayout
		{
			Header = new TextFlow { Text = title, Style = new TextStyle { FontSize = 5 } },
			Sections = new[] { new Section { Content = Rect(100, 100) } },
		});

		Assert.Equal(Texts(literal[0].Content), Texts(tokenised[0].Content));
	}

	[Fact]
	public void A_token_that_expands_stays_within_the_paper_width()
	{
		var pages = DocumentLayoutPass.Paginate(new DocumentLayout
		{
			Title = "A VERY LONG DRAWING TITLE THAT WILL NOT FIT IN THE MEASURED BAND AT ALL",
			Header = new TextFlow { Text = "{title}", Style = new TextStyle { FontSize = 5 } },
			Sections = new[] { new Section { Content = Rect(100, 100) } },
		});

		var bounds = pages[0].Content.ComputeBounds();

		Assert.True(bounds.MaxX <= PaperSize.A4.WidthMm + 0.001,
			$"content reaches x={bounds.MaxX:F2} on a {PaperSize.A4.WidthMm}mm sheet");
	}

	[Fact]
	public void Page_number_tokens_still_substitute_after_the_reorder()
	{
		// Substituting before layout must not break the tokens that need the page count — those
		// are resolved per page, after pagination has settled.
		var pages = DocumentLayoutPass.Paginate(new DocumentLayout
		{
			Header = new TextFlow { Text = "Sheet {page} of {pages}", Style = new TextStyle { FontSize = 3 } },
			Sections = new[] { new Section { Content = Rect(100, 100) } },
		});

		Assert.Contains("Sheet 1 of 1", Texts(pages[0].Content));
	}

	// ========================================================================================
	// Helpers
	// ========================================================================================

	private static PathElement Rect(double width, double height) => new PathElement
	{
		Path = new Path.Builder()
			.MoveTo(0, 0).LineTo(width, 0).LineTo(width, height).LineTo(0, height).Close().Build(),
		Stroke = new Stroke { Width = 0.25 },
	};

	private static PathElement Geometry(double width, double height) => new PathElement
	{
		Path = new Path.Builder()
			.MoveTo(0, 0).LineTo(width, 0).LineTo(width, height).LineTo(0, height).Close().Build(),
		Stroke = new Stroke { Width = 0.5 },
	};

	private static Frame BorderedFrame() => new Frame
	{
		Child = Rect(50, 50),
		Border = new Stroke { Width = 0.7 },
	};

	private static double VerticalOverlap(BoundingBox a, BoundingBox b)
	{
		if (a.IsEmpty || b.IsEmpty) return 0;
		var low = System.Math.Max(a.MinY, b.MinY);
		var high = System.Math.Min(a.MaxY, b.MaxY);
		return System.Math.Max(0, high - low);
	}

	private static List<Stroke> Strokes(DrawElement element)
	{
		var found = new List<Stroke>();
		Collect(element);
		return found;

		void Collect(DrawElement e)
		{
			switch (e)
			{
				case PathElement p when p.Stroke != null:
					found.Add(p.Stroke);
					break;
				case GroupElement g:
					foreach (var child in g.Children) Collect(child);
					break;
			}
		}
	}

	private static List<double> StrokeWidths(DrawElement element)
	{
		var widths = new List<double>();
		foreach (var stroke in Strokes(element)) widths.Add(stroke.Width);
		return widths;
	}

	private static List<string> Texts(DrawElement element)
	{
		var texts = new List<string>();
		Collect(element);
		return texts;

		void Collect(DrawElement e)
		{
			switch (e)
			{
				case TextElement t:
					texts.Add(t.Text);
					break;
				case GroupElement g:
					foreach (var child in g.Children) Collect(child);
					break;
			}
		}
	}
}
