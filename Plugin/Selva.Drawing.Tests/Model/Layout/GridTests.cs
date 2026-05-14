using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class GridTests
{
	[Fact]
	public void Absolute_columns_total_to_their_sum()
	{
		var grid = new Grid
		{
			Columns = new[] { GridLength.Absolute(20), GridLength.Absolute(30) },
			Rows = new[] { GridLength.Absolute(10) },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = Rect(5, 5) },
				new GridCell { Row = 0, Column = 1, Content = Rect(5, 5) },
			},
		};
		var b = grid.ComputeBounds();
		Assert.Equal(50, b.Width, 6);
		Assert.Equal(10, b.Height, 6);
	}

	[Fact]
	public void Auto_columns_size_to_content()
	{
		var grid = new Grid
		{
			Columns = new[] { GridLength.Auto, GridLength.Auto },
			Rows = new[] { GridLength.Auto },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = Rect(15, 8) },
				new GridCell { Row = 0, Column = 1, Content = Rect(7, 4) },
			},
		};
		var b = grid.ComputeBounds();
		Assert.Equal(22, b.Width, 6);
		Assert.Equal(8, b.Height, 6);
	}

	[Fact]
	public void Star_columns_fill_available_width()
	{
		var grid = new Grid
		{
			Columns = new[] { GridLength.Absolute(40), GridLength.Star(1), GridLength.Star(2) },
			Rows = new[] { GridLength.Absolute(10) },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = Rect(10, 5) },
				new GridCell { Row = 0, Column = 1, Content = Rect(10, 5) },
				new GridCell { Row = 0, Column = 2, Content = Rect(10, 5) },
			},
		};
		// Available width 100mm: 40 absolute + 60 split between two star tracks.
		var resolved = grid.Resolve(new LayoutContext(new BoundingBox(0, 0, 100, 100)));
		Assert.Equal(100, resolved.ComputeBounds().Width, 6);
	}

	[Fact]
	public void Row_zero_sits_at_top_of_grid()
	{
		var grid = new Grid
		{
			Columns = new[] { GridLength.Absolute(10) },
			Rows = new[] { GridLength.Absolute(5), GridLength.Absolute(5) },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = Marker(0, 0) },
				new GridCell { Row = 1, Column = 0, Content = Marker(0, 0) },
			},
		};
		var resolved = (GroupElement)grid.Resolve(new LayoutContext(BoundingBox.Empty));
		// Two positioned cells; row 0's marker should sit higher in world Y than row 1's.
		var row0 = ExtractMarkerY(resolved, 0);
		var row1 = ExtractMarkerY(resolved, 1);
		Assert.True(row0 > row1, $"row 0 marker y={row0} should be above row 1 y={row1}");
	}

	[Fact]
	public void Column_spacing_separates_columns()
	{
		var grid = new Grid
		{
			Columns = new[] { GridLength.Absolute(10), GridLength.Absolute(10) },
			Rows = new[] { GridLength.Absolute(10) },
			ColumnSpacing = 5,
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = Rect(1, 1) },
				new GridCell { Row = 0, Column = 1, Content = Rect(1, 1) },
			},
		};
		var b = grid.ComputeBounds();
		Assert.Equal(25, b.Width, 6);  // 10 + 5 + 10
	}

	private static double ExtractMarkerY(GroupElement g, int idx)
	{
		var child = g.Children[idx];
		// Each placed cell is wrapped in a translate group whose transform puts the marker
		// at its world position.
		if (child is GroupElement grp)
		{
			var pe = (PathElement)grp.Children[0];
			return pe.Path.ComputeBounds().MinY + grp.Transform.F;
		}
		return ((PathElement)child).Path.ComputeBounds().MinY;
	}

	[Fact]
	public void Auto_row_grows_to_fit_wrapped_TextFlow_in_star_column()
	{
		// Star column + Auto row + wrapping TextFlow. Pass 1 sized the row from the cell's
		// single-line natural height. Pass 2 wrapped the text to the column's resolved width
		// (much narrower than the natural width), making the cell taller than the row. Pass 3
		// re-grows the Auto row so the grid's reported height matches what's actually rendered.
		const string longText =
			"the quick brown fox jumps over the lazy dog and then jumps back again over the lazy dog";
		var grid = new Grid
		{
			Columns = new[] { GridLength.Star() },
			Rows = new[] { GridLength.Auto },
			Cells = new[]
			{
				new GridCell
				{
					Row = 0, Column = 0,
					Content = new TextFlow { Text = longText, Style = new TextStyle { FontSize = 3.0 } },
				},
			},
		};

		// Narrow context → text wraps to multiple lines.
		var ctx = new LayoutContext(new BoundingBox(0, 0, 30, 200));
		var resolved = grid.Resolve(ctx);
		var gridBounds = resolved.ComputeBounds();

		// Cell content's actual rendered height (after wrap).
		var cellGroup = (GroupElement)resolved;
		var cellBounds = cellGroup.Children[0].ComputeBounds();

		Assert.True(gridBounds.Height >= cellBounds.Height - 1e-6,
			$"grid reported {gridBounds.Height}mm but contains {cellBounds.Height}mm of content — Auto row didn't grow");
	}

	private static PathElement Marker(double x, double y) =>
		new PathElement
		{
			Path = new Path.Builder().MoveTo(x, y).LineTo(x + 1, y + 1).Build(),
		};

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}

