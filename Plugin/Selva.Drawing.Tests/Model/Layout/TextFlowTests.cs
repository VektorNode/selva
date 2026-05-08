using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Model.Layout;

public class TextFlowTests
{
	[Fact]
	public void Single_short_paragraph_is_one_line()
	{
		var flow = new TextFlow
		{
			Text = "hello",
			Width = 100,
			Style = new TextStyle { FontSize = 3.0 },
		};
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Single(resolved.Children);
		Assert.IsType<TextElement>(resolved.Children[0]);
	}

	[Fact]
	public void Long_text_wraps_when_width_constrains_it()
	{
		var flow = new TextFlow
		{
			Text = "the quick brown fox jumps over the lazy dog",
			Width = 25, // narrow enough that the line must break
			Style = new TextStyle { FontSize = 3.0 },
		};
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.True(resolved.Children.Count > 1, "expected wrapped text to produce multiple lines");
	}

	[Fact]
	public void Hard_newlines_force_paragraph_breaks()
	{
		var flow = new TextFlow
		{
			Text = "line one\nline two\nline three",
			Width = 1000, // wide enough that wrapping isn't triggered
			Style = new TextStyle { FontSize = 3.0 },
		};
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Equal(3, resolved.Children.Count);
	}

	[Fact]
	public void Each_line_descends_in_world_y()
	{
		var flow = new TextFlow
		{
			Text = "first\nsecond",
			Width = 1000,
			Origin = new Point2D(0, 0),
			Style = new TextStyle { FontSize = 3.0 },
		};
		var resolved = (GroupElement)flow.Resolve(new LayoutContext(BoundingBox.Empty));
		var line0 = (TextElement)resolved.Children[0];
		var line1 = (TextElement)resolved.Children[1];
		// Y-up: the first line's baseline is HIGHER than the second's.
		Assert.True(line0.Position.Y > line1.Position.Y);
	}
}
