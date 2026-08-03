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

// Every case here is a value the layout treated as "absent" or "unbounded" when it actually meant
// "none": an infinite budget, a collapsed content rect, a zero-extent geometry. Each produced
// silent off-sheet or NaN output rather than an exception, so only an assertion on the numbers
// catches them.
public class DegenerateInputTests
{
	// ========================================================================================
	// Infinite budgets
	// ========================================================================================

	[Fact]
	public void TextFlow_split_with_infinite_budget_fits_everything()
	{
		// (int)Math.Floor(+Infinity / lineHeight) is int.MinValue, read as "nothing fits" — that
		// made a KeepTogether section emit one line per page.
		var flow = LongFlow(40);
		var context = new LayoutContext(new BoundingBox(0, 0, 100, 100));

		var split = flow.TrySplit(double.PositiveInfinity, context);

		Assert.NotNull(split.Fits);
		Assert.Null(split.Overflow);
	}

	[Fact]
	public void TextFlow_split_with_infinite_budget_keeps_every_line()
	{
		var flow = LongFlow(40);
		var context = new LayoutContext(new BoundingBox(0, 0, 100, 100));

		var split = flow.TrySplit(double.PositiveInfinity, context);

		Assert.Equal(40, FindTexts(split.Fits).Count);
	}

	[Fact]
	public void Keep_together_section_does_not_explode_into_one_page_per_line()
	{
		// +Infinity reaches TextFlow through DocumentLayoutPass's KeepTogether path.
		var section = PaginationPass.PaginateBody(
			LongFlow(60), PaperSize.A4, Margins.Uniform(10), BandConfig.ContentMode(0, 0),
			availableHeightOverride: double.PositiveInfinity);

		Assert.Single(section.RawContents);
	}

	// ========================================================================================
	// Collapsed content rect
	// ========================================================================================

	[Fact]
	public void Chrome_that_consumes_the_body_does_not_emit_one_oversized_page()
	{
		// An empty content rect meant "no room" but was read as +Infinity ("unlimited room"), so
		// everything reported a fit and ran off the sheet. A 0.1mm header-height change used to
		// flip 120 pages to 1.
		var paper = PaperSize.A4;
		var margins = Margins.Uniform(10);
		var content = LongFlow(120);

		var justFits = PaginationPass.PaginateBody(content, paper, margins, BandConfig.ContentMode(276.9, 0));
		var collapsed = PaginationPass.PaginateBody(content, paper, margins, BandConfig.ContentMode(277.0, 0));

		Assert.True(collapsed.ContentRect.IsEmpty);
		Assert.Equal(justFits.RawContents.Count, collapsed.RawContents.Count);
	}

	[Fact]
	public void Collapsed_content_rect_keeps_page_content_within_the_paper_height()
	{
		var section = PaginationPass.PaginateBody(
			LongFlow(120), PaperSize.A4, Margins.Uniform(10), BandConfig.ContentMode(277.0, 0));

		var bounds = section.RawContents[0].ComputeBounds();

		Assert.True(bounds.Height <= PaperSize.A4.HeightMm,
			$"page content is {bounds.Height:F2}mm tall on a {PaperSize.A4.HeightMm}mm sheet");
	}

	// ========================================================================================
	// Zero-extent geometry
	// ========================================================================================

	[Fact]
	public void Zero_extent_geometry_in_a_sized_view_does_not_emit_nan()
	{
		// availW / 0 == +Infinity, which propagated into the group transform as NaN and emitted
		// "NaN NaN NaN NaN NaN NaN cm" into the PDF content stream without throwing.
		var view = new DrawingView
		{
			Geometry = Collapsed(),
			Size = new BoundingBox(0, 0, 60, 40),
		};

		var resolved = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));

		Assert.False(ContainsNaN(resolved));
	}

	[Fact]
	public void Zero_extent_geometry_in_an_auto_fit_view_does_not_emit_nan()
	{
		var view = new DrawingView { Geometry = Collapsed() };

		var resolved = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));

		Assert.False(ContainsNaN(resolved));
	}

	[Fact]
	public void Zero_extent_geometry_reports_a_finite_scale()
	{
		// The scale reaches a title block's {scale} token, which printed "Infinity".
		var view = new DrawingView { Geometry = Collapsed(), AutoScaleCaption = true };

		var resolved = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));

		var scale = FindMetadata(resolved, "selva:scale");
		Assert.NotNull(scale);
		Assert.True(double.TryParse(scale, System.Globalization.NumberStyles.Float,
			System.Globalization.CultureInfo.InvariantCulture, out var value));
		Assert.True(!double.IsNaN(value) && !double.IsInfinity(value), $"scale was '{scale}'");
	}

	[Fact]
	public void Geometry_flat_on_one_axis_still_fits_to_the_axis_that_has_extent()
	{
		// A horizontal line has no height ratio to satisfy, so it must scale by width rather
		// than collapsing the Math.Min to zero.
		var flat = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 5).LineTo(20, 5).Build(),
			Fill = new Fill { Color = Color.Black },
		};
		var view = new DrawingView { Geometry = flat };

		var resolved = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));

		Assert.False(ContainsNaN(resolved));
		Assert.False(resolved.ComputeBounds().IsEmpty);
	}

	// ========================================================================================
	// Paper-space invariance: symbols
	// ========================================================================================

	[Theory]
	[InlineData(0.1)]
	[InlineData(0.02)]
	[InlineData(20.0)]
	public void Symbol_children_are_counter_scaled_like_every_other_annotation(double scale)
	{
		// Symbols are north arrows and section marks — fixed size on the sheet. Their children
		// rode the view transform raw, so a 0.7mm stroke printed at 0.07mm at 1:10.
		var view = new DrawingView { Geometry = GeometryWithSymbol(), Scale = scale };

		var resolved = view.Resolve(new LayoutContext(BoundingBox.Empty));

		var widths = SymbolStrokeWidths(resolved);
		var only = Assert.Single(widths);
		Assert.Equal(0.7 / scale, only, 6);
	}

	[Fact]
	public void Symbol_definition_id_is_qualified_by_scale()
	{
		// Both renderers dedupe definitions by Id, and the PDF collector throws when one Id maps
		// to two different definitions — which two views at different scales would produce.
		var geometry = GeometryWithSymbol();
		var a = new DrawingView { Geometry = geometry, Scale = 0.1 }.Resolve(new LayoutContext(BoundingBox.Empty));
		var b = new DrawingView { Geometry = geometry, Scale = 0.02 }.Resolve(new LayoutContext(BoundingBox.Empty));

		var idA = Assert.Single(SymbolDefinitionIds(a));
		var idB = Assert.Single(SymbolDefinitionIds(b));

		Assert.NotEqual(idA, idB);
	}

	[Fact]
	public void Symbol_at_unit_scale_keeps_its_original_definition_id()
	{
		// No counter-scaling happens at 1:1, so the Id must survive untouched — otherwise every
		// unscaled symbol gets a spurious suffix and existing renderer caches miss.
		var view = new DrawingView { Geometry = GeometryWithSymbol(), Scale = 1.0 };

		var resolved = view.Resolve(new LayoutContext(BoundingBox.Empty));

		Assert.Equal("north", Assert.Single(SymbolDefinitionIds(resolved)));
	}

	// ========================================================================================
	// Helpers
	// ========================================================================================

	private static TextFlow LongFlow(int lineCount)
	{
		var lines = new List<string>(lineCount);
		for (var i = 0; i < lineCount; i++) lines.Add($"line number {i} of the long note");
		return new TextFlow
		{
			Text = string.Join("\n", lines),
			Width = 100,
			Style = new TextStyle { FontSize = 2.5 },
		};
	}

	// A path whose every point is identical: valid, non-empty bounds, zero extent on both axes.
	private static PathElement Collapsed() => new PathElement
	{
		Path = new Path.Builder().MoveTo(5, 5).LineTo(5, 5).Close().Build(),
		Fill = new Fill { Color = Color.Black },
	};

	private static GroupElement GeometryWithSymbol() => new GroupElement
	{
		Children = new DrawElement[]
		{
			new PathElement
			{
				Path = new Path.Builder().MoveTo(0, 0).LineTo(100, 0).LineTo(100, 100).LineTo(0, 100).Close().Build(),
				Stroke = new Stroke { Width = 0.25 },
			},
			new SymbolElement
			{
				Position = Point2D.Zero,
				Definition = new SymbolDefinition
				{
					Id = "north",
					Children = new DrawElement[]
					{
						new PathElement
						{
							Path = new Path.Builder().MoveTo(0, 0).LineTo(0, 10).Build(),
							Stroke = new Stroke { Width = 0.7 },
						},
					},
				},
			},
		},
	};

	private static bool ContainsNaN(DrawElement element)
	{
		if (element is not GroupElement group) return false;
		var t = group.Transform;
		if (double.IsNaN(t.A) || double.IsNaN(t.B) || double.IsNaN(t.C) ||
			double.IsNaN(t.D) || double.IsNaN(t.E) || double.IsNaN(t.F)) return true;
		foreach (var child in group.Children)
			if (ContainsNaN(child)) return true;
		return false;
	}

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

	private static List<double> SymbolStrokeWidths(DrawElement element)
	{
		var widths = new List<double>();
		Collect(element);
		return widths;

		void Collect(DrawElement e)
		{
			switch (e)
			{
				case SymbolElement s when s.Definition != null:
					foreach (var child in s.Definition.Children)
						if (child is PathElement p && p.Stroke != null) widths.Add(p.Stroke.Width);
					break;
				case GroupElement g:
					foreach (var child in g.Children) Collect(child);
					break;
			}
		}
	}

	private static List<string?> SymbolDefinitionIds(DrawElement element)
	{
		var ids = new List<string?>();
		Collect(element);
		return ids;

		void Collect(DrawElement e)
		{
			switch (e)
			{
				case SymbolElement s when s.Definition != null:
					ids.Add(s.Definition.Id);
					break;
				case GroupElement g:
					foreach (var child in g.Children) Collect(child);
					break;
			}
		}
	}

	private static List<string> FindTexts(DrawElement element)
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
