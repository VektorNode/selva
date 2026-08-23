using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;
using ModelDimensionStyle = Selva.Drawing.Model.Elements.DimensionStyle;

namespace Selva.Drawing.Tests.Model;

public class ElementTests
{
	[Fact]
	public void PathElement_bounds_inflate_by_half_stroke_width()
	{
		var path = new Path.Builder().MoveTo(0, 0).LineTo(10, 0).Build();
		var e = new PathElement { Path = path, Stroke = new Stroke { Width = 2.0 } };
		var b = e.ComputeBounds();
		Assert.Equal(-1, b.MinX);
		Assert.Equal(-1, b.MinY);
		Assert.Equal(11, b.MaxX);
		Assert.Equal(1, b.MaxY);
	}

	[Fact]
	public void TextElement_uses_measured_bounds_when_set()
	{
		var measured = new BoundingBox(1, 2, 3, 4);
		var e = new TextElement { Text = "hello", Position = new Point2D(0, 0), MeasuredBounds = measured };
		Assert.Equal(measured, e.ComputeBounds());
	}

	[Fact]
	public void TextElement_uses_real_font_metrics_for_bundled_family()
	{
		// Inter is bundled, so bounds come from real glyph advance, not the 0.55×charCount
		// heuristic. Exact width depends on Inter's metrics, but it must exceed the heuristic
		// for "ABC" (cap letters are wider than the heuristic assumes).
		var e = new TextElement
		{
			Text = "ABC",
			Position = new Point2D(10, 20),
			Style = new TextStyle { FontFamily = "Inter", FontSize = 4, HorizontalAnchor = TextAnchor.Left, VerticalAnchor = VerticalAnchor.Middle, LineHeight = 1.2 }
		};
		var b = e.ComputeBounds();
		Assert.Equal(10, b.MinX);
		Assert.True(b.MaxX > 10, $"MaxX should be past Position.X (got {b.MaxX})");
		Assert.NotEqual(16.6, System.Math.Round(b.MaxX, 6));
	}

	[Fact]
	public void TextElement_falls_back_to_heuristic_for_unknown_family()
	{
		var e = new TextElement
		{
			Text = "ABC",
			Position = new Point2D(10, 20),
			Style = new TextStyle { FontFamily = "ThisFontDoesNotExist", FontSize = 4, HorizontalAnchor = TextAnchor.Left, VerticalAnchor = VerticalAnchor.Middle, LineHeight = 1.2 }
		};
		var b = e.ComputeBounds();
		Assert.Equal(10, b.MinX);
		Assert.Equal(16.6, System.Math.Round(b.MaxX, 6)); // 3 chars * 4 size * 0.55 = 6.6, +10 origin
	}

	[Fact]
	public void TextBlockElement_returns_its_box()
	{
		var box = new BoundingBox(0, 0, 100, 50);
		var e = new TextBlockElement { Text = "wrapped", Box = box };
		Assert.Equal(box, e.ComputeBounds());
	}

	[Fact]
	public void ImageElement_bounds_at_position_and_size()
	{
		var e = new ImageElement
		{
			Data = new byte[] { 0, 1, 2 },
			Format = ImageFormat.Png,
			Position = new Point2D(10, 5),
			Width = 30,
			Height = 20
		};
		var b = e.ComputeBounds();
		Assert.Equal(10, b.MinX);
		Assert.Equal(5, b.MinY);
		Assert.Equal(40, b.MaxX);
		Assert.Equal(25, b.MaxY);
	}

	[Fact]
	public void GroupElement_unions_children_and_applies_transform()
	{
		var pathA = new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 0).Build(), Stroke = null };
		var pathB = new PathElement { Path = new Path.Builder().MoveTo(0, 5).LineTo(10, 5).Build(), Stroke = null };
		var g = new GroupElement { Children = new DrawElement[] { pathA, pathB }, Transform = Transform.Translate(100, 200) };

		var b = g.ComputeBounds();
		Assert.Equal(100, b.MinX);
		Assert.Equal(200, b.MinY);
		Assert.Equal(110, b.MaxX);
		Assert.Equal(205, b.MaxY);
	}

	[Fact]
	public void DimensionElement_includes_endpoints_with_safety_padding()
	{
		var e = new DimensionElement
		{
			Kind = DimensionKind.Linear,
			A = new Point2D(0, 0),
			B = new Point2D(10, 0),
			Offset = 5,
			Style = new ModelDimensionStyle { TextSize = 2.5 }
		};
		var b = e.ComputeBounds();
		// Conservative bound: AB inflated by |offset| + 4*textSize (15mm).
		Assert.True(b.MinX <= 0 - 15);
		Assert.True(b.MaxX >= 10 + 15);
	}

	[Fact]
	public void Element_metadata_round_trips()
	{
		var meta = new Dictionary<string, string> { { "rhino-id", "123" } };
		var e = new PathElement { Id = "p1", CssClass = "edge", Metadata = meta };
		Assert.Equal("p1", e.Id);
		Assert.Equal("edge", e.CssClass);
		Assert.Equal("123", e.Metadata["rhino-id"]);
	}
}
