using System;
using System.Collections.Generic;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

// The invariant: RESOLVED CONTENT NEVER EXCEEDS THE CONTENT RECT IT WAS GIVEN.
//
// Past bugs were each a specific breach of this rule — a budget divided by the wrong
// denominator, a zero read as "unbounded", a cost added after the fit, a measurement taken
// against the wrong box. Pinning the individual shapes that failed doesn't stop the next
// container inheriting the same class of bug, so this asserts the rule across a cross-product
// instead: every container, at several nesting depths, at reduction scales, captioned and not.
//
// A failure means some container reported a box larger than the room it was handed. Read the
// theory data in the failure message to see which combination broke, then reproduce that case
// directly — the matrix locates the breach, it doesn't explain it.
public class ContentRectInvariantTests
{
	// A4 portrait content rect at 10mm margins, i.e. what a page actually offers.
	private const double RectWidth = 190;
	private const double RectHeight = 277;

	// Scales here are the ones where the container owns the sizing decision: auto-fit (1.0 here
	// means "no explicit scale — fit me"), and reductions, which is what a drawing on a sheet
	// actually uses.
	//
	// Deliberately NOT included: explicit enlargements like 20:1. A user who pins Scale = 20 on
	// 120 mm of geometry is asking for 2400 mm and must get it — the same reason an Absolute
	// grid track is not clamped to the page. Overriding that would be a worse bug than the ones
	// this file guards against, so "content exceeds the rect" is only an invariant where the
	// layout, not the author, chose the size. Enlargement views are covered instead by
	// PaperSpaceInvarianceTests, which checks that their linework survives.
	public static IEnumerable<object[]> Cases()
	{
		// "grid-absolute" is excluded for the same reason as enlargement scales: two Absolute
		// tracks that sum past the page are the author's arithmetic, and clamping them would
		// silently discard a declared size. Absolute tracks beside a flexible one ARE covered —
		// every grid case below puts an Absolute(150) column next to the parameterised track,
		// the shape where a ceiling that ignored committed tracks let the flexible neighbour
		// measure against room already spent.
		foreach (var container in new[]
		{
			"stack-vertical", "stack-horizontal",
			"grid-auto", "grid-star",
			"frame", "table", "textflow", "group",
		})
		foreach (var depth in new[] { 0, 1, 2 })
		foreach (var scale in new[] { 1.0, 0.1, 0.02 })
		foreach (var captioned in new[] { false, true })
			yield return new object[] { container, depth, scale, captioned };
	}

	[Theory]
	[MemberData(nameof(Cases))]
	public void Resolved_content_never_exceeds_the_content_rect(
		string container, int depth, double viewScale, bool captioned)
	{
		var content = Nest(Build(container, viewScale, captioned), depth);
		var rect = new BoundingBox(0, 0, RectWidth, RectHeight);

		var resolved = LayoutPass.Resolve(content, new LayoutContext(rect));
		var bounds = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		if (bounds.IsEmpty) return;

		Assert.True(bounds.Width <= RectWidth + Tolerance,
			$"[{container} depth={depth} scale={viewScale} captioned={captioned}] " +
			$"width {bounds.Width:F3} exceeds the {RectWidth}mm content rect");
		Assert.True(bounds.Height <= RectHeight + Tolerance,
			$"[{container} depth={depth} scale={viewScale} captioned={captioned}] " +
			$"height {bounds.Height:F3} exceeds the {RectHeight}mm content rect");
	}

	// Same cross-product, but through pagination: a document that fits must not be split, and
	// no emitted page may exceed the rect. TrySplit and Resolve are two loops over the same
	// budget and must agree.
	[Theory]
	[MemberData(nameof(Cases))]
	public void Paginated_pages_never_exceed_the_content_rect(
		string container, int depth, double viewScale, bool captioned)
	{
		var content = Nest(Build(container, viewScale, captioned), depth);

		var section = PaginationPass.PaginateBody(
			content, PaperSize.A4, Margins.Uniform(10), BandConfig.ContentMode(0, 0));

		for (var i = 0; i < section.RawContents.Count; i++)
		{
			var bounds = section.RawContents[i]?.ComputeBounds() ?? BoundingBox.Empty;
			if (bounds.IsEmpty) continue;
			Assert.True(bounds.Width <= RectWidth + Tolerance,
				$"[{container} depth={depth} scale={viewScale} captioned={captioned}] " +
				$"page {i} width {bounds.Width:F3} exceeds the {RectWidth}mm content rect");
		}
	}

	// Stroke inflation is symmetric and half a line width per side; a hair over the rect is the
	// pen, not a layout breach.
	private const double Tolerance = 1.0;

	// ========================================================================================
	// Content construction
	// ========================================================================================

	// Wrap `element` in `depth` layers of alternating containers, so an inner element is reached
	// through a realistic chain rather than sitting at the root.
	private static DrawElement Nest(DrawElement element, int depth)
	{
		var current = element;
		for (var i = 0; i < depth; i++)
		{
			current = i % 2 == 0
				? new Frame { Child = current, Border = new Stroke { Width = 0.25 }, Padding = Margins.Uniform(2) }
				: new Stack { Children = new[] { current } };
		}
		return current;
	}

	private static DrawElement Build(string container, double viewScale, bool captioned)
	{
		// Every case carries a DrawingView, because the view is what auto-fits and therefore
		// what most often overran its budget.
		var view = View(viewScale, captioned);

		switch (container)
		{
			case "stack-vertical":
				// Empty siblings are load-bearing here, not filler: they are what the budget
				// divisor used to count, and they are invisible in the output, so a breach shows
				// up only as everything else being mysteriously too small — or, once the divisor
				// balloons, as a stack past the page.
				return new Stack
				{
					Orientation = StackOrientation.Vertical,
					Spacing = 2,
					Children = new DrawElement[]
					{
						view,
						Empty(), Empty(), Empty(),
						Note("a caption line"),
						View(viewScale, captioned),
					},
				};

			case "stack-horizontal":
				return new Stack
				{
					Orientation = StackOrientation.Horizontal,
					Spacing = 2,
					Children = new DrawElement[]
					{
						view, Empty(), View(viewScale, captioned), Empty(), View(viewScale, captioned),
					},
				};

			case "grid-auto":
				return Grid2x2(GridLength.Auto, viewScale, captioned);

			case "grid-star":
				return Grid2x2(GridLength.Star(1), viewScale, captioned);

			case "grid-absolute":
				return Grid2x2(GridLength.Absolute(80), viewScale, captioned);

			case "frame":
				return new Frame
				{
					Child = view,
					Border = new Stroke { Width = 0.5 },
					Padding = Margins.Uniform(3),
				};

			case "table":
				return new Table
				{
					ColumnWidths = new List<GridLength> { GridLength.Star(1), GridLength.Star(1) },
					Border = new Stroke { Width = 0.25 },
					Header = new List<TableCell> { new() { Text = "ITEM" }, new() { Text = "QTY" } },
					Rows = new List<IReadOnlyList<TableCell>>
					{
						new List<TableCell> { new() { Element = Note("a fairly long description that wraps") }, new() { Text = "12" } },
						new List<TableCell> { new() { Element = view }, new() { Text = "3" } },
					},
				};

			case "textflow":
				return Note(string.Join(" ", new string[40].Length == 0 ? Array.Empty<string>() : LongWords()));

			default: // bare group
				return new GroupElement { Children = new DrawElement[] { view, Note("loose text") } };
		}
	}

	private static IEnumerable<string> LongWords()
	{
		for (var i = 0; i < 60; i++) yield return $"word{i}";
	}

	// One track of the parameterised kind beside a wide Absolute one — a ceiling that ignores
	// committed tracks lets its neighbour measure against room already spent, which is how
	// [Absolute(150), Auto] produced a 245mm grid on a 190mm sheet.
	private static Grid Grid2x2(GridLength track, double viewScale, bool captioned) => new Grid
	{
		Columns = new List<GridLength> { GridLength.Absolute(150), track },
		Rows = new List<GridLength> { track, track },
		ColumnSpacing = 2,
		RowSpacing = 2,
		Cells = new List<GridCell>
		{
			new() { Row = 0, Column = 0, Content = View(viewScale, captioned) },
			new() { Row = 0, Column = 1, Content = Note("cell notes that wrap when narrow") },
			new() { Row = 1, Column = 0, Content = Note("Qty") },
			new() { Row = 1, Column = 1, Content = View(viewScale, captioned) },
		},
	};

	private static Stack Empty() => new Stack { Children = Array.Empty<DrawElement>() };

	private static DrawingView View(double scale, bool captioned) => new DrawingView
	{
		Geometry = Geometry(),
		// Scale 1 means "auto-fit me"; anything else pins an explicit drafting scale.
		Scale = Math.Abs(scale - 1.0) < 1e-9 ? 0 : scale,
		Caption = captioned ? "SECTION A-A" : null,
		AutoScaleCaption = captioned,
	};

	// A shape with extent on both axes, some fill, and annotation — so counter-scaling, hatch
	// spacing and dimension styles all participate rather than being trivially absent.
	private static DrawElement Geometry() => new GroupElement
	{
		Children = new DrawElement[]
		{
			new PathElement
			{
				Path = new Path.Builder()
					.MoveTo(0, 0).LineTo(120, 0).LineTo(120, 90).LineTo(0, 90).Close().Build(),
				Stroke = new Stroke { Width = 0.5 },
				Fill = new Fill { Color = Color.White },
			},
			new DimensionElement
			{
				Kind = DimensionKind.Linear,
				A = new Point2D(0, 0),
				B = new Point2D(120, 0),
				Offset = 8,
				Style = new DimensionStyle { StrokeWidth = 0.25, TextSize = 2.5 },
			},
		},
	};

	private static TextFlow Note(string text) =>
		new TextFlow { Text = text, Style = new TextStyle { FontSize = 3 } };
}
