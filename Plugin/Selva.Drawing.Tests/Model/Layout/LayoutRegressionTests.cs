using System.Collections.Generic;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

// Regressions covering force-place pagination, per-axis layout constraints, body token
// substitution, stripe parity, and empty-child spacing.
public class LayoutRegressionTests
{
	[Fact]
	public void Oversize_first_stack_child_force_places_and_pagination_continues()
	{
		// Page content height 10mm. First child is 30mm (never fits), second is 4mm — the
		// oversize child gets its own page and the second still paginates. Previously the
		// whole remaining stack dumped onto one page and pagination stopped.
		var stack = new Stack
		{
			Children = new DrawElement[] { Rect(5, 30), Rect(5, 4) },
		};
		var paper = new PaperSize(20, 10, "T20x10");
		var pages = PaginationPass.Paginate(stack, paper, Margins.Zero);

		Assert.Equal(2, pages.Count);
		Assert.NotNull(pages[0].Content);
		Assert.NotNull(pages[1].Content);
	}

	[Fact]
	public void Body_text_tokens_are_substituted()
	{
		var text = new TextElement
		{
			Text = "Sheet {page} of {pages}",
			Position = new Point2D(5, 5),
			Style = new TextStyle { FontSize = 3 },
		};
		var pages = PaginationPass.Paginate(text, PaperSize.A4, Margins.Uniform(10));

		var rendered = FindTexts(pages[0].Content);
		Assert.Contains("Sheet 1 of 1", rendered);
	}

	[Fact]
	public void Table_stripes_continue_across_page_split()
	{
		var stripes = new Fill[] { null!, new Fill { Color = Color.Rgb(0.9f, 0.9f, 0.9f) } };
		var rows = new IReadOnlyList<TableCell>[]
		{
			new[] { new TableCell { Text = "a" } },
			new[] { new TableCell { Text = "b" } },
			new[] { new TableCell { Text = "c" } },
		};
		var table = new Table { Rows = rows, RowHeight = 5, RowStripeFills = stripes };

		// Budget fits exactly one 5mm row → overflow continues the cycle at slot 1.
		var split = table.TrySplit(5.5, new LayoutContext(new BoundingBox(0, 0, 50, 5.5)));
		var overflow = Assert.IsType<Table>(split.Overflow);
		Assert.Equal(1, overflow.StripeOffset);
	}

	[Fact]
	public void Stack_skips_spacing_for_empty_children()
	{
		// An empty group occupies no space, so it must not consume a spacing slot either —
		// previously the content floated Spacing mm past the stack's declared extent.
		var stack = new Stack
		{
			Spacing = 5,
			Children = new DrawElement[] { new GroupElement(), Rect(10, 10) },
		};
		var bounds = stack.Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds();
		Assert.Equal(10, bounds.Height, 6);
	}

	[Fact]
	public void DrawingView_in_vertical_stack_fits_to_width_only()
	{
		// Tall geometry (50×100) in a 50mm-wide stack: the main axis is unbounded, so the
		// view fits width (scale 1.0 → height 100). Previously the stack handed children a
		// fictitious 50×50 square and the view shrank to half size.
		var view = new DrawingView
		{
			Geometry = Rect(50, 100),
			Padding = Margins.Zero,
		};
		var stack = new Stack { Children = new DrawElement[] { view } };

		var resolved = stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 50, 200)));
		var bounds = resolved.ComputeBounds();
		Assert.Equal(100, bounds.Height, 6);
	}

	[Fact]
	public void Frame_sizes_around_the_constrained_child_it_renders()
	{
		// Auto-fit view in a 50×50 context resolves to 50×50; the frame must measure that
		// constrained subtree, not the unconstrained natural size (100×100).
		var frame = new Frame
		{
			Child = new DrawingView { Geometry = Rect(100, 100), Padding = Margins.Zero },
			Padding = Margins.Zero,
		};
		var resolved = frame.Resolve(new LayoutContext(new BoundingBox(0, 0, 50, 50)));
		var bounds = resolved.ComputeBounds();
		Assert.Equal(50, bounds.Width, 6);
		Assert.Equal(50, bounds.Height, 6);
	}

	[Fact]
	public void Zero_margin_page_still_provides_page_bounds_to_layout()
	{
		// Zero margins are a legitimate full-bleed setting — the layout context must still
		// be the paper rect, so a TextFlow wraps instead of producing one endless line.
		var page = new Page
		{
			Size = PaperSize.A4,
			Margins = Margins.Zero,
			Content = new TextFlow
			{
				Text = string.Join(" ", System.Linq.Enumerable.Repeat("word", 200)),
				Style = new TextStyle { FontSize = 4 },
			},
		};
		var resolved = LayoutPass.ResolvePage(page);
		var bounds = resolved.Content.ComputeBounds();
		Assert.True(bounds.Width <= PaperSize.A4.WidthMm + 1e-6,
			$"text should wrap to the page width, got {bounds.Width}mm");
	}

	private static PathElement Rect(double width, double height) => new PathElement
	{
		Path = new Path.Builder()
			.MoveTo(0, 0)
			.LineTo(width, 0)
			.LineTo(width, height)
			.LineTo(0, height)
			.Close()
			.Build(),
	};

	private static List<string> FindTexts(DrawElement element)
	{
		var texts = new List<string>();
		Collect(element, texts);
		return texts;

		static void Collect(DrawElement e, List<string> into)
		{
			switch (e)
			{
				case TextElement t:
					into.Add(t.Text);
					break;
				case GroupElement g:
					foreach (var c in g.Children) Collect(c, into);
					break;
			}
		}
	}
}
