using System;
using System.Collections.Generic;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

// Regressions for the second batch of 2026-07-27 audit findings: view sizing costs that were
// applied after the budget was honoured (caption, padding), a scale derived from the wrong
// measurement (stroke-inflated bounds), chrome that grew off the sheet, and containers that
// reported a box smaller than what they drew.
public class ViewSizingTests
{
	// ========================================================================================
	// Caption and padding are costs that come OUT of the budget, not additions on top of it
	// ========================================================================================

	[Fact]
	public void A_captioned_view_with_an_explicit_size_occupies_exactly_that_size()
	{
		// The caption was stapled on after sizing, so a 60x40 view resolved to 60x44.5.
		var view = new DrawingView
		{
			Geometry = Rect(100, 100),
			Size = new BoundingBox(0, 0, 60, 40),
			Caption = "PLAN VIEW",
		};

		var bounds = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.Equal(60.0, bounds.Width, 3);
		Assert.Equal(40.0, bounds.Height, 3);
	}

	[Fact]
	public void A_captioned_auto_fit_view_stays_inside_a_height_bound_container()
	{
		// Auto-fit into a 277mm rect produced 281.5mm — 4.5mm into the footer.
		var view = new DrawingView { Geometry = Rect(100, 400), Caption = "PLAN VIEW" };

		var bounds = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Height <= 277.001, $"view is {bounds.Height:F3}mm tall in a 277mm rect");
	}

	[Fact]
	public void Padding_larger_than_the_view_shrinks_the_content_rather_than_growing_the_view()
	{
		// Padding is a margin taken out of a box, so it cannot exceed the box. Unclamped, a 20mm
		// view with 20mm padding resolved to 40x40 — the padding won and Size was ignored.
		var view = new DrawingView
		{
			Geometry = Rect(100, 100),
			Size = new BoundingBox(0, 0, 20, 20),
			Padding = Margins.Uniform(20),
		};

		var bounds = view.Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds();

		Assert.Equal(20.0, bounds.Width, 3);
		Assert.Equal(20.0, bounds.Height, 3);
	}

	[Theory]
	[InlineData(9.0)]
	[InlineData(10.0)]
	[InlineData(11.0)]
	public void Auto_fit_has_no_cliff_as_padding_approaches_the_available_size(double padding)
	{
		// There was a cliff exactly where available - padding hit 0: padding 9 gave 20x19.2 but
		// padding 10 gave 70.5x50.5.
		var view = new DrawingView { Geometry = Rect(100, 100), Padding = Margins.Uniform(padding) };

		var bounds = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 20, 20))).ComputeBounds();

		Assert.True(bounds.Width <= 20.001 && bounds.Height <= 20.001,
			$"padding {padding} produced {bounds.Width:F3}x{bounds.Height:F3} in a 20x20 budget");
	}

	// ========================================================================================
	// Line weight is a style, not a dimension — it must not move the drawing scale
	// ========================================================================================

	[Theory]
	[InlineData(0.0)]
	[InlineData(0.25)]
	[InlineData(1.0)]
	public void Stroke_weight_does_not_change_the_view_scale(double strokeWidth)
	{
		// The scale was derived from stroke-inflated bounds, so a 20mm square with Length=20
		// resolved to 1:0.952 at a 1.0mm weight — the "20mm" edge measured 19.05mm, and two
		// views of the same geometry at different weights would not align.
		var view = new DrawingView
		{
			Geometry = Rect(20, 20, strokeWidth),
			Length = 20,
			AutoScaleCaption = true,
		};

		var resolved = view.Resolve(new LayoutContext(BoundingBox.Empty));

		var scale = FindMetadata(resolved, "selva:scale");
		Assert.NotNull(scale);
		Assert.Equal(1.0, double.Parse(scale!, System.Globalization.CultureInfo.InvariantCulture), 6);
	}

	// ========================================================================================
	// Chrome must stay on the sheet
	// ========================================================================================

	[Fact]
	public void An_oversize_footer_grows_towards_the_page_not_off_the_bottom_edge()
	{
		// AnchorChrome top-aligned the footer, so content taller than its reserve grew downward
		// past the paper edge: an 8mm reserve holding 30mm of content landed 12mm below the sheet.
		var template = new PageTemplate
		{
			Footer = Rect(180, 30),
			FooterHeight = 8,
			FooterPlacement = ChromePlacement.Content,
		};

		var pages = PaginationPass.Paginate(Rect(100, 50), PaperSize.A4, Margins.Uniform(10), template);

		var bounds = pages[0].Content.ComputeBounds();
		Assert.True(bounds.MinY >= -0.001, $"page ink reaches y={bounds.MinY:F3}, below the paper edge");
	}

	[Fact]
	public void Negative_margins_do_not_push_the_page_rect_off_the_paper()
	{
		// Nothing downstream crops to the paper, so a negative margin simply moved the content
		// rect and both bands off the sheet: -10mm on A4 gave a page rect of -10..307.
		var section = PaginationPass.PaginateBody(
			Rect(100, 100), PaperSize.A4, new Margins(-10, -10, -10, -10), BandConfig.ContentMode(10, 10));

		Assert.True(section.PageRect.MinX >= -0.001 && section.PageRect.MinY >= -0.001,
			$"page rect starts at {section.PageRect.MinX:F1},{section.PageRect.MinY:F1}");
		Assert.True(section.PageRect.MaxY <= PaperSize.A4.HeightMm + 0.001,
			$"page rect reaches y={section.PageRect.MaxY:F1} on a {PaperSize.A4.HeightMm}mm sheet");
	}

	// ========================================================================================
	// A container must report the box it actually draws in
	// ========================================================================================

	[Fact]
	public void A_table_with_a_fixed_row_height_reports_the_box_it_actually_draws()
	{
		// An explicit RowHeight is an Absolute track and overflowing content is drawn, not
		// clipped — but the reported box stayed at the track total, so a RowHeight of 5 reported
		// h=5 while ~18mm of wrapped text hung below its own bottom edge.
		var table = new Table
		{
			RowHeight = 5.0,
			ColumnWidths = new List<GridLength> { GridLength.Absolute(30) },
			Rows = new List<IReadOnlyList<TableCell>>
			{
				new List<TableCell>
				{
					new() { Element = new TextFlow
					{
						Text = "a long piece of cell text that wraps to several lines when the column is narrow",
						Style = new TextStyle { FontSize = 3 },
					} },
				},
			},
		};

		var resolved = table.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));
		var reported = resolved.ComputeBounds();
		var drawn = DrawnExtent(resolved);

		Assert.True(reported.MinY <= drawn.Min + 0.001,
			$"table reports bottom {reported.MinY:F3} but draws to {drawn.Min:F3}");
	}

	// ========================================================================================
	// Declared column widths must be honoured
	// ========================================================================================

	[Fact]
	public void Declared_column_widths_survive_a_count_mismatch()
	{
		// A short ColumnWidths list discarded EVERY declared width and fell back to all-Star,
		// which reads as "ColumnWidths does nothing" rather than "one width is missing".
		var table = new Table
		{
			ColumnWidths = new List<GridLength> { GridLength.Absolute(20), GridLength.Absolute(20) },
			Rows = new List<IReadOnlyList<TableCell>>
			{
				new List<TableCell>
				{
					new() { Element = Note("a") }, new() { Element = Note("b") }, new() { Element = Note("c") },
				},
			},
		};

		var resolved = table.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));

		var trackWidths = CellGuideWidths(resolved);
		Assert.Equal(20.0, trackWidths[0], 2);
		Assert.Equal(20.0, trackWidths[1], 2);
	}

	// ========================================================================================
	// A leading empty child must not create a blank page
	// ========================================================================================

	[Fact]
	public void A_leading_empty_child_does_not_produce_a_blank_first_page()
	{
		// ForcePlace took Children[0] unconditionally, so an empty leading child became "the
		// head" of a forced page: a 1-page document turned into 2, the first drawing nothing.
		var withEmpty = new Stack
		{
			Children = new DrawElement[] { new Stack { Children = Array.Empty<DrawElement>() }, Rect(50, 300) },
		};
		var without = new Stack { Children = new DrawElement[] { Rect(50, 300) } };

		var a = PaginationPass.PaginateBody(withEmpty, PaperSize.A4, Margins.Uniform(10), BandConfig.ContentMode(0, 0));
		var b = PaginationPass.PaginateBody(without, PaperSize.A4, Margins.Uniform(10), BandConfig.ContentMode(0, 0));

		Assert.Equal(b.RawContents.Count, a.RawContents.Count);
		Assert.False(a.RawContents[0].ComputeBounds().IsEmpty, "first page is blank");
	}

	// ========================================================================================
	// Helpers
	// ========================================================================================

	private static TextFlow Note(string text) =>
		new TextFlow { Text = text, Style = new TextStyle { FontSize = 3 } };

	private static PathElement Rect(double width, double height, double strokeWidth = 0.25) => new PathElement
	{
		Path = new Path.Builder()
			.MoveTo(0, 0).LineTo(width, 0).LineTo(width, height).LineTo(0, height).Close().Build(),
		Stroke = new Stroke { Width = strokeWidth },
	};

	private static string? FindMetadata(DrawElement element, string key)
	{
		if (element is not GroupElement group) return null;
		if (group.Metadata != null && group.Metadata.TryGetValue(key, out var value)) return value;
		foreach (var child in group.Children)
		{
			var found = FindMetadata(child, key);
			if (found != null) return found;
		}
		return null;
	}

	// Vertical extent of everything actually drawn, following group transforms.
	private static (double Min, double Max) DrawnExtent(DrawElement element)
	{
		var min = double.MaxValue;
		var max = double.MinValue;
		Walk(element, Transform.Identity);
		return (min, max);

		void Walk(DrawElement e, Transform t)
		{
			switch (e)
			{
				case null:
					return;
				case GroupElement g:
					var next = g.Transform.IsIdentity ? t : t.Multiply(g.Transform);
					foreach (var child in g.Children) Walk(child, next);
					return;
				default:
					var b = e.ComputeBounds();
					if (b.IsEmpty) return;
					var p1 = t.Apply(new Point2D(b.MinX, b.MinY));
					var p2 = t.Apply(new Point2D(b.MaxX, b.MaxY));
					min = Math.Min(min, Math.Min(p1.Y, p2.Y));
					max = Math.Max(max, Math.Max(p1.Y, p2.Y));
					return;
			}
		}
	}

	// Grid emits a PreviewOnly guide box per track intersection; their widths are the tracks.
	private static List<double> CellGuideWidths(DrawElement element)
	{
		var widths = new List<double>();
		Walk(element);
		return widths;

		void Walk(DrawElement e)
		{
			if (e is not GroupElement g) return;
			if (g.PreviewOnly && g.BoundsOverride.HasValue) widths.Add(g.BoundsOverride.Value.Width);
			foreach (var child in g.Children) Walk(child);
		}
	}
}
