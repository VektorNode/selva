using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Drawings;

public class DrawingViewTests
{
	[Fact]
	public void Empty_view_resolves_to_group()
	{
		var view = new DrawingView();
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
	}

	[Fact]
	public void View_natural_size_is_geometry_times_scale_plus_padding()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(100, 50).Build(),
		};
		var view = new DrawingView
		{
			Geometry = geometry,
			Scale = 0.5,
			Padding = Margins.Uniform(5),
		};
		var b = view.ComputeBounds();
		// 100×50 path, scaled 0.5 = 50×25, +10×10 padding = 60×35 (rounded: stroke half-width adds ±0.125).
		Assert.Equal(60, b.Width, 1);
		Assert.Equal(35, b.Height, 1);
	}

	[Fact]
	public void Resolved_view_stamps_the_scale_it_rendered_at()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(100, 50).Build(),
		};
		var view = new DrawingView { Geometry = geometry, Length = 20 };
		var resolved = view.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved.Metadata);
		Assert.True(resolved.Metadata.TryGetValue(DrawingView.ScaleMetadataKey, out var raw));
		Assert.Equal(0.2, double.Parse(raw, System.Globalization.CultureInfo.InvariantCulture), 6);
	}

	[Fact]
	public void Auto_fit_view_stamps_the_fitted_scale()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(200, 100).Build(),
		};
		var view = new DrawingView { Geometry = geometry, Padding = Margins.Zero };
		var resolved = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 100, 100)));
		Assert.True(resolved.Metadata.TryGetValue(DrawingView.ScaleMetadataKey, out var raw));
		Assert.Equal(0.5, double.Parse(raw, System.Globalization.CultureInfo.InvariantCulture), 6);
	}

	[Fact]
	public void Auto_scale_caption_labels_the_inferred_ratio()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(100, 50).Build(),
		};
		var view = new DrawingView { Geometry = geometry, Length = 20, AutoScaleCaption = true };
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Equal("SCALE 1:5", FindCaption(resolved));
	}

	[Fact]
	public void Explicit_caption_wins_over_auto_scale_caption()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(100, 50).Build(),
		};
		var view = new DrawingView { Geometry = geometry, Length = 20, AutoScaleCaption = true, Caption = "PLAN" };
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Equal("PLAN", FindCaption(resolved));
	}

	private static string? FindCaption(DrawElement element)
	{
		switch (element)
		{
			case TextElement t: return t.Text;
			case GroupElement g:
				foreach (var c in g.Children)
				{
					var v = FindCaption(c);
					if (v != null) return v;
				}
				return null;
			default: return null;
		}
	}

	[Fact]
	public void Fixed_size_view_pins_outer_bounds()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 10).Build(),
		};
		var view = new DrawingView
		{
			Geometry = geometry,
			Size = new BoundingBox(0, 0, 80, 50),
			Padding = Margins.Uniform(2),
		};
		var b = view.ComputeBounds();
		Assert.Equal(80, b.Width, 6);
		Assert.Equal(50, b.Height, 6);
	}

	[Fact]
	public void View_with_caption_grows_below_origin()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(20, 20).Build(),
		};
		var withCaption = new DrawingView
		{
			Geometry = geometry,
			Caption = "SCALE 1:5",
			Padding = Margins.Uniform(2),
		};
		var withoutCaption = new DrawingView
		{
			Geometry = geometry,
			Padding = Margins.Uniform(2),
		};
		var bWith = withCaption.ComputeBounds();
		var bWithout = withoutCaption.ComputeBounds();
		Assert.True(bWith.Height > bWithout.Height);
		Assert.True(bWith.MinY < 0); // caption sits below Origin.Y (0)
	}

	[Fact]
	public void Length_pins_longest_geometry_side()
	{
		// 200x50 landscape geometry, Length=80: long side -> 80mm, short side -> 80*(50/200)=20mm.
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(200, 50).Build(),
		};
		var view = new DrawingView
		{
			Geometry = geometry,
			Length = 80,
			Padding = Margins.Uniform(5),
		};
		var b = view.ComputeBounds();
		Assert.Equal(90, b.Width, 1);   // 80 + 10 padding
		Assert.Equal(30, b.Height, 1);  // 20 + 10 padding
	}

	[Fact]
	public void Auto_fits_to_layout_context_when_no_size_or_length()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(1000, 500).Build(),
		};
		var view = new DrawingView
		{
			Geometry = geometry,
			Padding = Margins.Uniform(5),
		};
		var resolved = (GroupElement)view.Resolve(new LayoutContext(new BoundingBox(0, 0, 100, 100)));
		var b = resolved.BoundsOverride!.Value;
		Assert.Equal(100, b.Width, 1);
		Assert.Equal(55, b.Height, 1);  // 45 inner + 10 padding
	}

	[Fact]
	public void Paper_space_text_keeps_font_size_when_view_is_scaled_down()
	{
		// Effective scale 0.1 (1000mm pinned to 100mm): a 3mm paper-space label must be
		// rewritten to FontSize=30 so the group's 0.1× transform renders it at 3mm.
		var label = new TextElement
		{
			Text = "Hi",
			Position = new Point2D(500, 250),
			Style = new TextStyle { FontSize = 3.0 },
		};
		var curve = new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(1000, 500).Build() };
		var view = new DrawingView
		{
			Geometry = new GroupElement { Children = new DrawElement[] { curve, label } },
			Length = 100,
		};
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		var scaledGroup = FindFirstScaledGroup(resolved);
		var rewrittenLabel = FindFirstText(scaledGroup!)!;
		Assert.Equal(30.0, rewrittenLabel.Style.FontSize, 6);
	}

	[Fact]
	public void Paper_space_text_counter_scales_padding_radius_and_letter_spacing()
	{
		// Same 0.1× scale as the FontSize test: padding, corner radius, and letter spacing are
		// all paper-space measurements, so they counter-scale (×10) the same way FontSize does.
		var label = new TextElement
		{
			Text = "Hi",
			Position = new Point2D(500, 250),
			Style = new TextStyle { FontSize = 3.0, LetterSpacing = 0.2 },
			Background = Color.White,
			BackgroundPadding = 1.0,
			BackgroundCornerRadius = 0.5,
		};
		var curve = new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(1000, 500).Build() };
		var view = new DrawingView
		{
			Geometry = new GroupElement { Children = new DrawElement[] { curve, label } },
			Length = 100,
		};
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		var scaledGroup = FindFirstScaledGroup(resolved);
		var rewrittenLabel = FindFirstText(scaledGroup!)!;
		Assert.Equal(10.0, rewrittenLabel.BackgroundPadding, 6);
		Assert.Equal(5.0, rewrittenLabel.BackgroundCornerRadius, 6);
		Assert.Equal(2.0, rewrittenLabel.Style.LetterSpacing, 6);
	}

	[Fact]
	public void Stroke_width_and_dash_pattern_are_paper_space()
	{
		// At Scale=0.1, stroke width and dash pattern counter-scale (×10) so the group's
		// transform renders them at the authored mm on the page.
		var curve = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(1000, 500).Build(),
			Stroke = new Stroke { Width = 0.25, DashArray = new[] { 4.0, 2.0 }, DashOffset = 1.0 },
		};
		var view = new DrawingView
		{
			Geometry = curve,
			Scale = 0.1,
		};
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		var scaledGroup = FindFirstScaledGroup(resolved);
		var rewritten = FindFirstPath(scaledGroup!)!;
		Assert.Equal(2.5, rewritten.Stroke.Width, 6);
		Assert.Equal(40.0, rewritten.Stroke.DashArray[0], 6);
		Assert.Equal(20.0, rewritten.Stroke.DashArray[1], 6);
		Assert.Equal(10.0, rewritten.Stroke.DashOffset, 6);
	}

	private static GroupElement? FindFirstScaledGroup(DrawElement element)
	{
		if (element is GroupElement g)
		{
			if (!g.Transform.IsIdentity) return g;
			foreach (var child in g.Children)
			{
				var hit = FindFirstScaledGroup(child);
				if (hit != null) return hit;
			}
		}
		return null;
	}

	private static TextElement? FindFirstText(DrawElement element)
	{
		if (element is TextElement t) return t;
		if (element is GroupElement g)
		{
			foreach (var child in g.Children)
			{
				var hit = FindFirstText(child);
				if (hit != null) return hit;
			}
		}
		return null;
	}

	private static PathElement? FindFirstPath(DrawElement element)
	{
		if (element is PathElement p) return p;
		if (element is GroupElement g)
		{
			foreach (var child in g.Children)
			{
				var hit = FindFirstPath(child);
				if (hit != null) return hit;
			}
		}
		return null;
	}

	private static DimensionElement? FindFirstDimension(DrawElement element)
	{
		if (element is DimensionElement d) return d;
		if (element is GroupElement g)
		{
			foreach (var child in g.Children)
			{
				var hit = FindFirstDimension(child);
				if (hit != null) return hit;
			}
		}
		return null;
	}

	// A dimension is an annotation: its text, arrows, and standoff are sized for the reader's
	// eye, so they must measure the same on paper at every drawing scale (ISO 129-1; the same
	// reason AutoCAD multiplies DIMEXO/DIMGAP by DIMSCALE). Offset used to ride the group
	// transform unscaled while TextSize was counter-scaled, so at 1:50 a 5 mm offset landed
	// 0.1 mm from the geometry and the label sat on top of what it measured.
	[Theory]
	[InlineData(1.0)]
	[InlineData(0.5)]
	[InlineData(0.1)]
	[InlineData(0.02)]
	public void Dimension_offset_is_paper_space(double scale)
	{
		var dim = new DimensionElement
		{
			Kind = DimensionKind.Linear,
			A = new Point2D(0, 0),
			B = new Point2D(100, 0),
			Offset = 5.0,
			Style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.5 },
		};
		var view = new DrawingView { Geometry = dim, Scale = scale };

		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		var rewritten = FindFirstDimension(FindFirstScaledGroup(resolved)!)!;

		Assert.Equal(5.0, rewritten.Offset * scale, 6);
	}

	// Offset and TextSize feed the same subtraction in the renderer (extension-line gap and
	// overshoot are derived from TextSize, then subtracted from Offset), so they have to be
	// counter-scaled by the same factor or that arithmetic mixes units.
	[Fact]
	public void Dimension_offset_and_text_size_scale_together()
	{
		var dim = new DimensionElement
		{
			Kind = DimensionKind.Linear,
			A = new Point2D(0, 0),
			B = new Point2D(1000, 0),
			Offset = 5.0,
			Style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.5 },
		};
		var view = new DrawingView { Geometry = dim, Scale = 0.1 };

		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		var rewritten = FindFirstDimension(FindFirstScaledGroup(resolved)!)!;

		Assert.Equal(50.0, rewritten.Offset, 6);
		Assert.Equal(25.0, rewritten.Style.TextSize, 6);
		// The authored ratio survives the rewrite, which is what keeps the gap arithmetic sane.
		Assert.Equal(5.0 / 2.5, rewritten.Offset / rewritten.Style.TextSize, 6);
	}

	// The measured points stay in world space — the reported distance must not change.
	[Fact]
	public void Dimension_endpoints_are_not_counter_scaled()
	{
		var dim = new DimensionElement
		{
			Kind = DimensionKind.Linear,
			A = new Point2D(0, 0),
			B = new Point2D(100, 0),
			Offset = 5.0,
			Style = new DimensionStyle { TextSize = 2.5 },
		};
		var view = new DrawingView { Geometry = dim, Scale = 0.02 };

		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		var rewritten = FindFirstDimension(FindFirstScaledGroup(resolved)!)!;

		Assert.Equal(0, rewritten.A.X, 6);
		Assert.Equal(100, rewritten.B.X, 6);
	}

	[Fact]
	public void Format_scale_label_handles_common_ratios()
	{
		Assert.Equal("SCALE 1:1", DrawingView.FormatScaleLabel(1.0));
		Assert.Equal("SCALE 1:5", DrawingView.FormatScaleLabel(0.2));
		Assert.Equal("SCALE 1:10", DrawingView.FormatScaleLabel(0.1));
		Assert.Equal("SCALE 2:1", DrawingView.FormatScaleLabel(2.0));
	}
}
