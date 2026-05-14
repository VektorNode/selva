using System.Linq;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Model.Layout;

// Width = null → fill the parent's available width. Verifies each container forwards
// LayoutContext correctly so users don't have to pre-compute wrapping widths.
public class AutoWidthTextFlowTests
{
	private const string LongText =
		"the quick brown fox jumps over the lazy dog and then jumps back again over the lazy dog";

	[Fact]
	public void TextFlow_with_null_width_falls_back_to_no_wrap_in_unconstrained_context()
	{
		var flow = new TextFlow { Text = LongText, Style = new TextStyle { FontSize = 3.0 } };
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Single(resolved.Children); // one line — no wrapping when no parent constraint
	}

	[Fact]
	public void TextFlow_with_null_width_wraps_to_context_available_width()
	{
		var flow = new TextFlow { Text = LongText, Style = new TextStyle { FontSize = 3.0 } };
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(new BoundingBox(0, 0, 30, 100)));
		Assert.True(resolved.Children.Count > 1, "expected multiple lines when context constrains width");
	}

	[Fact]
	public void TextFlow_inside_Frame_with_fixed_size_wraps_to_inner_width()
	{
		var frame = new Frame
		{
			Size = new BoundingBox(0, 0, 40, 200),
			Padding = Margins.Uniform(2),
			Child = new TextFlow { Text = LongText, Style = new TextStyle { FontSize = 3.0 } },
		};
		var resolved = (GroupElement)frame.Resolve(new LayoutContext(BoundingBox.Empty));
		var textGroup = FindFirstTextGroup(resolved);
		Assert.NotNull(textGroup);
		Assert.True(textGroup!.Children.Count > 1,
			"expected wrapping when frame's inner width constrains the text");
	}

	[Fact]
	public void TextFlow_inside_vertical_Stack_wraps_to_stack_cross_axis()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[]
			{
				new TextFlow { Text = LongText, Style = new TextStyle { FontSize = 3.0 } },
			},
		};
		var resolved = (GroupElement)stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 35, 200)));
		var textGroup = FindFirstTextGroup(resolved);
		Assert.NotNull(textGroup);
		Assert.True(textGroup!.Children.Count > 1,
			"expected wrapping when stack's cross-axis constrains the text");
	}

	[Fact]
	public void TextFlow_inside_Grid_star_column_wraps_to_resolved_column_width()
	{
		var grid = new Grid
		{
			Columns = new[] { GridLength.Absolute(20), GridLength.Star() },
			Rows = new[] { GridLength.Auto },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = new TextElement { Text = "L", Position = Point2D.Zero, Style = new TextStyle { FontSize = 3.0 } } },
				new GridCell { Row = 0, Column = 1, Content = new TextFlow { Text = LongText, Style = new TextStyle { FontSize = 3.0 } } },
			},
		};
		var resolved = (GroupElement)grid.Resolve(new LayoutContext(new BoundingBox(0, 0, 70, 100)));
		// Find the multi-line group — the long-text cell, not the "L" cell.
		var multiLineGroup = FindAllTextGroups(resolved).OrderByDescending(g => g.Children.Count).First();
		Assert.True(multiLineGroup.Children.Count > 1,
			"expected wrapping inside a star column whose width was resolved by the grid");
	}

	[Fact]
	public void Table_cell_text_wraps_to_resolved_column_width_in_star_column()
	{
		var table = new Table
		{
			ColumnWidths = new[] { GridLength.Absolute(15), GridLength.Star() },
			Rows = new[]
			{
				new[] { Cell("Note"), Cell(LongText) },
			},
			DefaultCellStyle = new TextStyle { FontSize = 3.0 },
		};
		var resolved = (GroupElement)table.Resolve(new LayoutContext(new BoundingBox(0, 0, 70, 200)));
		var multiLineGroup = FindAllTextGroups(resolved).OrderByDescending(g => g.Children.Count).First();
		Assert.True(multiLineGroup.Children.Count > 1,
			"expected wrapping in a Star column without the user pre-computing the width");
	}

	[Fact]
	public void Stack_with_Stretch_makes_auto_width_TextFlow_wrap_to_parent_cross()
	{
		// Stretch alignment + a long auto-width TextFlow inside a vertical stack: the
		// TextFlow should wrap to the parent's available width (60mm), not the natural
		// width of the longest sibling. Verifying via wrap behaviour rather than measured
		// glyph extent — text never fills every pixel of the wrap line.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			CrossAlign = CrossAlign.Stretch,
			Children = new DrawElement[]
			{
				new TextFlow { Text = "short", Style = new TextStyle { FontSize = 3.0 } },
				new TextFlow { Text = LongText, Style = new TextStyle { FontSize = 3.0 } },
			},
		};
		var resolved = stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 60, 200)));
		var multiLineGroup = FindAllTextGroups(resolved).OrderByDescending(g => g.Children.Count).First();
		Assert.True(multiLineGroup.Children.Count > 1,
			"expected the long TextFlow to wrap to the parent's 60mm cross-axis under Stretch");
	}

	[Fact]
	public void Stack_with_Start_alignment_does_not_force_parent_cross_on_children()
	{
		// Without Stretch, a single short child shouldn't be forced to the parent width
		// — the stack reports the child's natural width and Start alignment leaves it
		// alone.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			CrossAlign = CrossAlign.Start,
			Children = new DrawElement[]
			{
				new TextFlow { Text = "short", Width = 10, Style = new TextStyle { FontSize = 3.0 } },
			},
		};
		var resolved = stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 200, 200)));
		var b = resolved.ComputeBounds();
		Assert.True(b.Width <= 11, $"expected natural width (~10mm), got {b.Width}");
	}

	private static TableCell Cell(string text) => new TableCell { Text = text };

	[Fact]
	public void Explicit_width_overrides_context()
	{
		var flow = new TextFlow { Text = LongText, Width = 1000, Style = new TextStyle { FontSize = 3.0 } };
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(new BoundingBox(0, 0, 20, 100)));
		Assert.Single(resolved.Children); // explicit Width wins, fits on one line
	}

	// Walk the resolved subtree and return the first GroupElement whose first child is a
	// TextElement — that's a TextFlow's per-line group, possibly wrapped in translate
	// groups by the parent layout.
	private static GroupElement? FindFirstTextGroup(DrawElement element)
		=> FindAllTextGroups(element).FirstOrDefault();

	private static System.Collections.Generic.IEnumerable<GroupElement> FindAllTextGroups(DrawElement element)
	{
		if (element is not GroupElement g) yield break;
		if (g.Children.Count > 0 && g.Children[0] is TextElement)
			yield return g;
		foreach (var child in g.Children)
			foreach (var found in FindAllTextGroups(child))
				yield return found;
	}
}
