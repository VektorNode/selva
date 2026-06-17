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
	public void Iso7200_layout_has_four_rows_and_pins_size()
	{
		var values = new Dictionary<string, string>
		{
			["Project"] = "Bracket assembly",
			["Owner"] = "ACME Robotics",
			["Title"] = "Top plate",
			["DrawingNumber"] = "BR-001",
			["Revision"] = "B",
			["Scale"] = "1:5",
			["Sheet"] = "1/3",
			["Author"] = "FB",
			["Approver"] = "JD",
			["Date"] = "2026-04-30",
		};
		var block = TitleBlock.Iso7200(values);
		Assert.Equal(4, block.Rows.Count);
		// First row's first cell is the blank logo cell.
		Assert.Null(block.Rows[0][0]);
		var b = block.ComputeBounds();
		Assert.Equal(180, b.Width, 6);
		Assert.Equal(50, b.Height, 6);
	}

	[Fact]
	public void Continuation_strip_is_a_single_slim_row()
	{
		var block = TitleBlock.Continuation(new Dictionary<string, string>
		{
			["DrawingNumber"] = "BR-001",
			["Title"] = "Top plate",
			["Revision"] = "B",
			["Sheet"] = "2/3",
		});
		Assert.Single(block.Rows);
		var b = block.ComputeBounds();
		Assert.Equal(180, b.Width, 6);
		Assert.Equal(12, b.Height, 6);
	}

	[Fact]
	public void Auto_width_stretches_to_a_narrow_band()
	{
		// A4 content width (~190mm) is below the ISO full-width threshold → stretch to the band.
		var block = new TitleBlock
		{
			Size = new BoundingBox(0, 0, 180, 40),
			AutoWidth = true,
			Rows = TitleBlock.Iso7200(null).Rows,
		};
		var resolved = block.Resolve(new LayoutContext(new BoundingBox(0, 0, 190, 40)));
		Assert.Equal(190, resolved.ComputeBounds().Width, 6);
	}

	[Fact]
	public void Auto_width_keeps_fixed_size_on_a_wide_band()
	{
		// A3-wide band (~400mm) is above the threshold → keep the 180mm corner block.
		var block = new TitleBlock
		{
			Size = new BoundingBox(0, 0, 180, 40),
			AutoWidth = true,
			Rows = TitleBlock.Iso7200(null).Rows,
		};
		var resolved = block.Resolve(new LayoutContext(new BoundingBox(0, 0, 400, 40)));
		Assert.Equal(180, resolved.ComputeBounds().Width, 6);
	}

	[Fact]
	public void Auto_width_falls_back_to_fixed_size_when_band_unknown()
	{
		var block = new TitleBlock
		{
			Size = new BoundingBox(0, 0, 180, 40),
			AutoWidth = true,
			Rows = TitleBlock.Iso7200(null).Rows,
		};
		var resolved = block.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Equal(180, resolved.ComputeBounds().Width, 6);
	}

	[Fact]
	public void Logo_is_placed_top_left_within_the_first_row()
	{
		var logo = new ImageElement
		{
			Data = new byte[] { 1, 2, 3 },
			Format = ImageFormat.Png,
			Width = 20,
			Height = 10,
		};
		var block = new TitleBlock
		{
			Size = new BoundingBox(0, 0, 180, 40),
			Logo = logo,
			Rows = TitleBlock.Iso7200(null).Rows,
		};
		var resolved = (GroupElement)block.Resolve(new LayoutContext(BoundingBox.Empty));
		var placed = FindImage(resolved);
		Assert.NotNull(placed);
		// 4 rows over 40mm → 10mm row; logo fitted into (10 − 3) = 7mm tall, aspect 2:1 → 14mm wide.
		Assert.Equal(7, placed.Height, 6);
		Assert.Equal(14, placed.Width, 6);
		// Top-left: y sits near the top of the block, x near the left edge.
		Assert.True(placed.Position.X >= 0 && placed.Position.X < 5);
		Assert.True(placed.Position.Y > 40 - 12); // within the top row band
	}

	private static ImageElement FindImage(DrawElement element)
	{
		switch (element)
		{
			case ImageElement img: return img;
			case GroupElement g:
				foreach (var c in g.Children)
				{
					var found = FindImage(c);
					if (found != null) return found;
				}
				return null;
			default: return null;
		}
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
