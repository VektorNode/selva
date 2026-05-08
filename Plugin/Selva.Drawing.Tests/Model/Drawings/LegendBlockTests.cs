using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Drawings;

public class LegendBlockTests
{
	[Fact]
	public void Empty_legend_resolves_to_group()
	{
		var legend = new LegendBlock();
		var resolved = legend.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
	}

	[Fact]
	public void Legend_with_entries_has_positive_bounds()
	{
		var swatch = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 0).Build(),
			Stroke = new Stroke { Width = 0.5 },
		};
		var legend = new LegendBlock
		{
			Width = 80,
			Entries = new[]
			{
				new LegendEntry { Swatch = swatch, Description = "Solid stroke, 0.5mm" },
				new LegendEntry { Swatch = swatch, Description = "Dashed centreline" },
			},
		};
		var b = legend.ComputeBounds();
		Assert.True(b.Width > 0);
		Assert.True(b.Height > 0);
	}

	[Fact]
	public void Legend_with_title_grows_taller_than_legend_without()
	{
		var swatch = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 0).Build(),
		};
		var entries = new[] { new LegendEntry { Swatch = swatch, Description = "X" } };

		var withTitle = new LegendBlock { Title = "Symbols", Entries = entries };
		var without = new LegendBlock { Entries = entries };

		Assert.True(withTitle.ComputeBounds().Height > without.ComputeBounds().Height);
	}
}
