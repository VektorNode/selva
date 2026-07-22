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
		// Geometry path is 100×50; scaled by 0.5 = 50×25; +10×10 padding = 60×35.
		// Stroke half-width on the inner geometry inflates the path bounds by ±0.125 each.
		// Frame border is null, so outer width is exactly 50+10 = 60 mm wide.
		Assert.Equal(60, b.Width, 1);
		Assert.Equal(35, b.Height, 1);
	}

	[Fact]
	public void Resolved_view_stamps_the_scale_it_rendered_at()
	{
		// 100mm geometry pinned to 20mm longest side → scale 0.2 (1:5).
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
		// Fit into a 100×100 band → longest side 200 maps to 100 → scale 0.5.
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
		// Caption sits below Origin.Y (0), so MinY < 0 with caption.
		Assert.True(bWith.MinY < 0);
	}

	[Fact]
	public void Length_pins_longest_geometry_side()
	{
		// Geometry is 200×50 (landscape). Length=80 should make the long side 80mm and the
		// short side 80*(50/200)=20mm. Plus uniform 5mm padding on each side.
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
		// 1000×500 geometry resolved into a 100×100 context (post-padding inner = 90×90)
		// should fit longest side to 90 → effective scale 0.09 → 90×45 inner + 10 padding.
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
		// 1000mm geometry pinned to 100mm: effective scale = 0.1. A 3mm paper-space label
		// should be rewritten to FontSize=30 so the group's 0.1× transform renders it at 3mm.
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
		// Same 0.1× setup as the FontSize test: padding (1mm), corner radius (0.5mm), and
		// letter spacing (0.2mm) are all paper-space measurements that should multiply by
		// 1/scale = 10 so the group transform renders them at the requested mm on the page.
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
		// View at Scale=0.1 (1:10). A 0.25 mm stroke and a [4, 2] mm dash pattern should be
		// rewritten to 2.5 and [40, 20] respectively, so the group's 0.1× transform renders
		// them at the authored mm on the page.
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

	[Fact]
	public void Format_scale_label_handles_common_ratios()
	{
		Assert.Equal("SCALE 1:1", DrawingView.FormatScaleLabel(1.0));
		Assert.Equal("SCALE 1:5", DrawingView.FormatScaleLabel(0.2));
		Assert.Equal("SCALE 1:10", DrawingView.FormatScaleLabel(0.1));
		Assert.Equal("SCALE 2:1", DrawingView.FormatScaleLabel(2.0));
	}
}
