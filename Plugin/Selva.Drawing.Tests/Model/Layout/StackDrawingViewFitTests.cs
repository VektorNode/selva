using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

// A DrawingView with no Scale/Size/Length auto-fits to its layout context. A Stack used to
// hand children an infinite main axis, so the view fitted only the cross axis: tall geometry
// in a vertical stack sized past the bottom of the page and ran through the footer, and a row
// of views in a horizontal stack ran off the right edge. The stack now forwards the real
// main-axis budget it already knows, so "auto-fit" means "fit the box you are in" at any
// nesting depth.
public class StackDrawingViewFitTests
{
	private const double PageW = 210, PageH = 297, MarginMm = 20, BandMm = 15;

	private static DrawingView AutoFitView(double geomWidth, double geomHeight) => new DrawingView
	{
		Geometry = new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(geomWidth, 0).LineTo(geomWidth, geomHeight).LineTo(0, geomHeight)
				.Close().Build(),
			Stroke = new Stroke { Color = Color.Black, Width = LineWeight.Fine },
		},
	};

	private static BandConfig Bands => new BandConfig
	{
		HeaderHeight = BandMm,
		FooterHeight = BandMm,
		HeaderPlacement = ChromePlacement.Content,
		FooterPlacement = ChromePlacement.Content,
	};

	private static SectionLayout Paginate(DrawElement content) =>
		PaginationPass.PaginateBody(
			content,
			new PaperSize(PageW, PageH),
			new Margins(MarginMm, MarginMm, MarginMm, MarginMm),
			Bands);

	private static void AssertFitsContentRect(SectionLayout layout)
	{
		var rect = layout.ContentRect;
		for (var i = 0; i < layout.RawContents.Count; i++)
		{
			var b = layout.RawContents[i]?.ComputeBounds() ?? BoundingBox.Empty;
			if (b.IsEmpty) continue;
			Assert.True(b.Height <= rect.Height + 1e-6,
				$"page {i} height {b.Height:0.##} exceeds content rect {rect.Height:0.##} — content runs through the footer");
			Assert.True(b.Width <= rect.Width + 1e-6,
				$"page {i} width {b.Width:0.##} exceeds content rect {rect.Width:0.##} — content runs off the page edge");
		}
	}

	// Geometry taller than it is wide: fitting width alone forced ~667 mm of height onto a
	// 227 mm content rect. DrawingView cannot split, so pagination could not rescue it.
	[Fact]
	public void Tall_auto_fit_view_in_a_vertical_stack_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[] { AutoFitView(100, 400) },
		}));
	}

	[Fact]
	public void Tall_auto_fit_view_in_nested_stacks_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[]
			{
				new Stack
				{
					Orientation = StackOrientation.Vertical,
					Children = new DrawElement[] { AutoFitView(100, 400) },
				},
			},
		}));
	}

	// The horizontal case needs the width budget specifically — clamping inside DrawingView
	// could not fix it, because a horizontal stack never handed down a width at all.
	[Fact]
	public void Horizontal_stack_of_auto_fit_views_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Stack
		{
			Orientation = StackOrientation.Horizontal,
			Spacing = 5,
			Children = new DrawElement[] { AutoFitView(100, 80), AutoFitView(100, 80), AutoFitView(100, 80) },
		}));
	}

	[Fact]
	public void Horizontal_stack_nested_in_a_vertical_stack_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[]
			{
				new Stack
				{
					Orientation = StackOrientation.Horizontal,
					Spacing = 5,
					Children = new DrawElement[] { AutoFitView(100, 80), AutoFitView(100, 80), AutoFitView(100, 80) },
				},
			},
		}));
	}

	[Fact]
	public void Several_stacked_views_share_the_page_without_overflowing()
	{
		AssertFitsContentRect(Paginate(new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 5,
			Children = new DrawElement[] { AutoFitView(100, 80), AutoFitView(100, 80), AutoFitView(100, 80) },
		}));
	}

	// The budget is a ceiling for flexible children, not a resize of fixed ones: an explicit
	// Scale must still win, even when that overflows — the user asked for that size.
	[Fact]
	public void Explicit_scale_is_not_overridden_by_the_stack_budget()
	{
		var view = new DrawingView
		{
			Geometry = AutoFitView(100, 100).Geometry,
			Scale = 1.0,
		};
		var stack = new Stack { Orientation = StackOrientation.Vertical, Children = new DrawElement[] { view } };

		// Same width whether the stack is squeezed, unconstrained, or absent: an explicit
		// Scale is a fixed size, so the budget must not touch it. (The absolute value carries
		// the view's frame padding and stroke on top of the 100 mm of geometry, which is why
		// this compares the three against each other rather than against a literal.)
		var squeezed = stack.Resolve(new LayoutContext(new BoundingBox(0, 0, 50, 50))).ComputeBounds().Width;
		var unconstrained = stack.Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds().Width;
		var bare = view.Resolve(new LayoutContext(new BoundingBox(0, 0, 50, 50))).ComputeBounds().Width;

		Assert.Equal(bare, squeezed, 6);
		Assert.Equal(bare, unconstrained, 6);
		Assert.True(squeezed > 100, "explicit 1:1 scale should keep the geometry at full size");
	}

	// Grid had the same defect from a different direction: Pass 1 measured cells with an empty
	// context, so an auto-fit view reported an unbounded natural size, and that became the Auto
	// track's size. Auto tracks grow to fit their content, so nothing clamped it afterwards.
	[Fact]
	public void Grid_of_auto_tracks_holding_tall_views_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Grid
		{
			Columns = new[] { GridLength.Auto, GridLength.Auto },
			Rows = new[] { GridLength.Auto, GridLength.Auto },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = AutoFitView(100, 400) },
				new GridCell { Row = 0, Column = 1, Content = AutoFitView(100, 400) },
				new GridCell { Row = 1, Column = 0, Content = AutoFitView(100, 400) },
				new GridCell { Row = 1, Column = 1, Content = AutoFitView(100, 400) },
			},
		}));
	}

	[Fact]
	public void Grid_of_star_columns_holding_tall_views_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Grid
		{
			Columns = new[] { GridLength.Star(1), GridLength.Star(1), GridLength.Star(1) },
			Rows = new[] { GridLength.Auto },
			Cells = new[]
			{
				new GridCell { Row = 0, Column = 0, Content = AutoFitView(100, 400) },
				new GridCell { Row = 0, Column = 1, Content = AutoFitView(100, 400) },
				new GridCell { Row = 0, Column = 2, Content = AutoFitView(100, 400) },
			},
		}));
	}

	[Fact]
	public void Grid_cell_holding_a_stack_of_tall_views_stays_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Grid
		{
			Columns = new[] { GridLength.Star(1) },
			Rows = new[] { GridLength.Auto },
			Cells = new[]
			{
				new GridCell
				{
					Row = 0,
					Column = 0,
					Content = new Stack
					{
						Orientation = StackOrientation.Vertical,
						Children = new DrawElement[] { AutoFitView(100, 400) },
					},
				},
			},
		}));
	}

	// Containers must compose: the budget has to survive every hop down the tree, not just one.
	[Fact]
	public void Deeply_nested_containers_keep_the_view_inside_the_content_rect()
	{
		AssertFitsContentRect(Paginate(new Grid
		{
			Columns = new[] { GridLength.Auto },
			Rows = new[] { GridLength.Auto },
			Cells = new[]
			{
				new GridCell
				{
					Row = 0,
					Column = 0,
					Content = new Stack
					{
						Orientation = StackOrientation.Vertical,
						Children = new DrawElement[]
						{
							new Grid
							{
								Columns = new[] { GridLength.Auto },
								Rows = new[] { GridLength.Auto },
								Cells = new[]
								{
									new GridCell { Row = 0, Column = 0, Content = AutoFitView(100, 400) },
								},
							},
						},
					},
				},
			},
		}));
	}

	// The path a real Page takes when all its content arrives in ONE branch: GH_Page composes
	// a single branch by wrapping it in a GroupElement rather than a Stack. A Group is a
	// primitive, so pagination used to measure it without resolving — the DrawingViews inside
	// never saw the page context, kept their natural size, and ran off the sheet (904 mm of
	// content on a 277 mm rect).
	[Fact]
	public void Views_grouped_in_a_single_branch_stay_inside_the_content_rect()
	{
		var branch = new GroupElement
		{
			Children = new DrawElement[] { AutoFitView(60, 400), AutoFitView(900, 120) },
		};

		AssertFitsContentRect(Paginate(branch));
	}

	[Fact]
	public void Views_in_a_translated_branch_group_stay_inside_the_content_rect()
	{
		// NormalizeToOrigin wraps the branch in a transformed Group, which is the shape that
		// actually reaches pagination.
		var branch = new GroupElement
		{
			Transform = Transform.Translate(-25, -40),
			Children = new DrawElement[]
			{
				new GroupElement
				{
					Children = new DrawElement[] { AutoFitView(60, 400), AutoFitView(900, 120) },
				},
			},
		};

		AssertFitsContentRect(Paginate(branch));
	}

	// An even split means a child's size cannot depend on where it sits in the list.
	[Fact]
	public void Sibling_order_does_not_change_a_views_size()
	{
		var first = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 5,
			Children = new DrawElement[] { AutoFitView(100, 50), AutoFitView(100, 50) },
		}.Resolve(new LayoutContext(new BoundingBox(0, 0, 170, 227)));

		var reversed = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 5,
			Children = new DrawElement[] { AutoFitView(100, 50), AutoFitView(100, 50) },
		}.Resolve(new LayoutContext(new BoundingBox(0, 0, 170, 227)));

		Assert.Equal(first.ComputeBounds().Height, reversed.ComputeBounds().Height, 6);
	}
}
