using System.Collections.Generic;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;

namespace Selva.Drawing.Tests.Model.Drawings;

public class TitleBlockTests
{
	[Fact]
	public void Empty_title_block_resolves_to_outer_frame()
	{
		var block = new TitleBlock { Size = new BoundingBox(0, 0, 100, 30) };
		var resolved = block.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
		var b = resolved.ComputeBounds();
		Assert.Equal(100, b.Width, 6);
		Assert.Equal(30, b.Height, 6);
	}

	[Fact]
	public void Title_block_pins_size_regardless_of_content()
	{
		var block = new TitleBlock
		{
			Size = new BoundingBox(0, 0, 180, 40),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				new[]
				{
					new TitleBlockField { Label = "PROJECT", Value = "Bracket assembly", Span = 0.6 },
					new TitleBlockField { Label = "CLIENT", Value = "ACME Robotics", Span = 0.4 },
				},
				new[] { new TitleBlockField { Label = "TITLE", Value = "Top plate" } },
			},
		};
		var b = block.ComputeBounds();
		Assert.Equal(180, b.Width, 6);
		Assert.Equal(40, b.Height, 6);
	}

	[Fact]
	public void Standard_layout_produces_four_rows_filling_the_size()
	{
		var values = new Dictionary<string, string>
		{
			["Project"] = "Bracket assembly",
			["Title"] = "Top plate",
			["DrawingNumber"] = "BR-001",
			["Scale"] = "1:5",
			["Sheet"] = "1 of 1",
			["Author"] = "FB",
			["Date"] = "2026-04-30",
		};
		var block = TitleBlock.Standard(values);
		var b = block.ComputeBounds();
		Assert.Equal(180, b.Width, 6);
		Assert.Equal(40, b.Height, 6);
		Assert.Equal(4, block.Rows.Count);
	}

	[Fact]
	public void Resolve_includes_inner_grid_lines_when_border_set()
	{
		var block = new TitleBlock
		{
			Size = new BoundingBox(0, 0, 100, 30),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				new[] { new TitleBlockField { Label = "A", Value = "1" }, new TitleBlockField { Label = "B", Value = "2" } },
				new[] { new TitleBlockField { Label = "C", Value = "3" } },
			},
		};
		var resolved = (GroupElement)block.Resolve(new LayoutContext(BoundingBox.Empty));
		// Last child should be the border PathElement.
		Assert.IsType<PathElement>(resolved.Children[resolved.Children.Count - 1]);
	}
}
