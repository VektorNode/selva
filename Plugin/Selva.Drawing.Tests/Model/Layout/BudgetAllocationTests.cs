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

// How Stack and Grid divide a budget between children/tracks. Both had the same shape of
// bug: a measurement pass that guessed at each child's share up front, using a divisor that
// counted things which would go on to take no space at all, so unrelated content changed
// the size of a drawing.
public class BudgetAllocationTests
{
	// ========================================================================================
	// Empty children must not consume budget
	// ========================================================================================

	[Theory]
	[InlineData(0)]
	[InlineData(1)]
	[InlineData(3)]
	[InlineData(5)]
	public void Empty_siblings_do_not_shrink_the_view_beside_them(int emptyCount)
	{
		// The per-child budget divided by the number of children still to be measured, counting
		// ones that occupy nothing. A conditionally-empty branch (an empty nested Stack, a
		// blank TextFlow) silently rescaled every view on the sheet: 100mm alone, 16.7mm
		// beside five.
		var children = new List<DrawElement> { new DrawingView { Geometry = Geometry(100, 100) } };
		for (var i = 0; i < emptyCount; i++) children.Add(EmptyStack());

		var bounds = new Stack { Children = children }
			.Resolve(new LayoutContext(new BoundingBox(0, 0, 100, 100))).ComputeBounds();

		Assert.Equal(100.0, bounds.Height, 3);
	}

	[Fact]
	public void Empty_siblings_cost_nothing_even_with_no_spacing()
	{
		// Isolates the per-child divisor from the spacing reserve: with Spacing=0 the spacing
		// reserve can't be responsible, and the defect still showed 100/6.
		var children = new List<DrawElement> { new DrawingView { Geometry = Geometry(100, 100) } };
		for (var i = 0; i < 5; i++) children.Add(EmptyStack());

		var bounds = new Stack { Children = children, Spacing = 0 }
			.Resolve(new LayoutContext(new BoundingBox(0, 0, 100, 100))).ComputeBounds();

		Assert.Equal(100.0, bounds.Height, 3);
	}

	// ========================================================================================
	// Sibling count must not set the drawing scale
	// ========================================================================================

	[Fact]
	public void Adding_a_caption_below_a_view_does_not_halve_the_view()
	{
		// The view used to drop from 190mm to 143mm purely because a second child existed,
		// leaving ~48% of the sheet blank.
		var page = new LayoutContext(new BoundingBox(0, 0, 190, 277));
		var alone = new Stack { Children = new DrawElement[] { new DrawingView { Geometry = Geometry(100, 100) } } };
		var captioned = new Stack
		{
			Children = new DrawElement[]
			{
				new DrawingView { Geometry = Geometry(100, 100) },
				new TextFlow { Text = "Figure 1 - the caption", Style = new TextStyle { FontSize = 3 } },
			},
		};

		var aloneHeight = ViewHeight(alone.Resolve(page));
		var captionedHeight = ViewHeight(captioned.Resolve(page));

		Assert.Equal(aloneHeight, captionedHeight, 3);
	}

	// ========================================================================================
	// A nested TrySplit must not size against the whole page
	// ========================================================================================

	[Theory]
	[InlineData(100.0)]
	[InlineData(30.0)]
	public void Split_honours_the_budget_it_was_given_not_the_context_it_was_handed(double contextHeight)
	{
		// The context was built once from the whole available height and never narrowed, so a
		// nested stack sized against the entire page while the parent had only `remaining`
		// left, and the parent accepted the returned FitsHeight unchecked. TrySplit(30) came
		// back claiming FitsHeight=100.
		var stack = new Stack
		{
			Children = new DrawElement[] { new DrawingView { Geometry = Geometry(100, 100) } },
		};

		var split = stack.TrySplit(30, new LayoutContext(new BoundingBox(0, 0, 100, contextHeight)));

		Assert.True(split.FitsHeight <= 30.001,
			$"reported FitsHeight={split.FitsHeight:F3} for a 30mm budget");
	}

	// ========================================================================================
	// A track ceiling must account for tracks already committed
	// ========================================================================================

	[Fact]
	public void An_auto_column_beside_an_absolute_one_stays_on_the_sheet()
	{
		// available / trackCount never subtracted the Absolute tracks, so the Auto neighbour
		// measured against room that was never available.
		var grid = new Grid
		{
			Columns = new List<GridLength> { GridLength.Absolute(150), GridLength.Auto },
			Rows = new List<GridLength> { GridLength.Auto },
			Cells = new List<GridCell>
			{
				new() { Row = 0, Column = 0, Content = Rect(150, 10) },
				new() { Row = 0, Column = 1, Content = Note("some notes here that will wrap") },
			},
		};

		var bounds = grid.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Width <= 190.001, $"grid is {bounds.Width:F3}mm wide on a 190mm rect");
	}

	[Fact]
	public void Two_auto_columns_do_not_each_claim_the_whole_budget()
	{
		// The naive "budget - known" fix reintroduces an older bug: each unknown track measures
		// against the full remainder and 2 Auto columns sum to 380 on a 190 budget. The
		// ceiling must divide among the unknown tracks, not hand each of them everything.
		var grid = new Grid
		{
			Columns = new List<GridLength> { GridLength.Auto, GridLength.Auto },
			Rows = new List<GridLength> { GridLength.Auto },
			Cells = new List<GridCell>
			{
				new() { Row = 0, Column = 0, Content = Note("left column text") },
				new() { Row = 0, Column = 1, Content = Note("right column text") },
			},
		};

		var bounds = grid.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Width <= 190.001, $"grid is {bounds.Width:F3}mm wide on a 190mm rect");
	}

	// ========================================================================================
	// Auto must hug its content, not inflate to the budget
	// ========================================================================================

	[Theory]
	[InlineData(200.0)]
	[InlineData(400.0)]
	public void Auto_columns_hug_their_content_regardless_of_the_budget(double budget)
	{
		// Any width-filling child reported the ceiling it was measured against as its natural
		// width, making Auto byte-identical to Star. Two "Qty" cells (about 10mm of ink)
		// sized to whatever the page offered.
		var grid = new Grid
		{
			Columns = new List<GridLength> { GridLength.Auto, GridLength.Auto },
			Rows = new List<GridLength> { GridLength.Auto },
			Cells = new List<GridCell>
			{
				new() { Row = 0, Column = 0, Content = Note("Qty") },
				new() { Row = 0, Column = 1, Content = Note("Qty") },
			},
		};

		var unconstrained = grid.Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds();
		var constrained = grid.Resolve(new LayoutContext(new BoundingBox(0, 0, budget, 277))).ComputeBounds();

		Assert.Equal(unconstrained.Width, constrained.Width, 3);
	}

	[Fact]
	public void TextFlow_reports_the_width_it_occupies_not_the_width_it_may_wrap_within()
	{
		// Resolve pinned the bounds width to the wrap box, so "Qty" (about 5mm of ink)
		// reported 190mm inside a page-width context.
		var flow = Note("Qty");

		var unconstrained = flow.Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds();
		var onAPage = flow.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.Equal(unconstrained.Width, onAPage.Width, 3);
		Assert.True(onAPage.Width < 20, $"'Qty' reported {onAPage.Width:F3}mm");
	}

	[Fact]
	public void A_frame_around_short_text_hugs_the_text()
	{
		var frame = new Frame { Child = Note("NOTE"), Border = new Stroke { Width = 0.25 } };

		var bounds = frame.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Width < 30, $"frame around 'NOTE' is {bounds.Width:F3}mm wide");
	}

	[Fact]
	public void Centred_text_is_still_centred_within_its_wrap_box()
	{
		// The anchor arithmetic deliberately uses the wrap box, not the ink width: "centred"
		// means centred in the box the author asked to wrap within. Reporting ink width as
		// the bounds must not disturb that.
		var centred = new TextFlow
		{
			Text = "SHORT",
			Style = new TextStyle { FontSize = 3, HorizontalAnchor = TextAnchor.Center },
		};

		var resolved = centred.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277)));

		var position = Assert.Single(TextPositions(resolved));
		Assert.Equal(95.0, position, 3);
	}

	[Fact]
	public void A_long_unbreakable_word_does_not_report_more_than_its_wrap_box()
	{
		// A single word wider than the budget can't be broken, but reporting more than the
		// budget would push the overflow back onto the container.
		var flow = new TextFlow
		{
			Text = "SUPERCALIFRAGILISTICEXPIALIDOCIOUSSUPERCALIFRAGILISTICEXPIALIDOCIOUS",
			Width = 20,
			Style = new TextStyle { FontSize = 5 },
		};

		var bounds = flow.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 277))).ComputeBounds();

		Assert.True(bounds.Width <= 20.001, $"reported {bounds.Width:F3}mm for a 20mm wrap box");
	}

	// ========================================================================================
	// Helpers
	// ========================================================================================

	private static TextFlow Note(string text) =>
		new TextFlow { Text = text, Style = new TextStyle { FontSize = 3 } };

	private static Stack EmptyStack() => new Stack { Children = Array.Empty<DrawElement>() };

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

	private static double ViewHeight(DrawElement element)
	{
		var found = -1.0;
		Walk(element);
		return found;

		void Walk(DrawElement e)
		{
			if (found >= 0 || e is not GroupElement g) return;
			if (g.Metadata != null && g.Metadata.ContainsKey("selva:scale"))
			{
				found = g.ComputeBounds().Height;
				return;
			}
			foreach (var child in g.Children) Walk(child);
		}
	}

	private static List<double> TextPositions(DrawElement element)
	{
		var positions = new List<double>();
		Walk(element);
		return positions;

		void Walk(DrawElement e)
		{
			switch (e)
			{
				case TextElement t:
					positions.Add(t.Position.X);
					break;
				case GroupElement g:
					foreach (var child in g.Children) Walk(child);
					break;
			}
		}
	}
}
