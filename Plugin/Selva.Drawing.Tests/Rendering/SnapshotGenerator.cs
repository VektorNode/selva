using System.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Svg;
using Color = Selva.Drawing.Model.Style.Color;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering;

// Regenerates the pinned snapshot files. No-op unless SELVA_GENERATE_SNAPSHOTS=1, so
// normal test runs don't overwrite the snapshots they're checking against.
public class SnapshotGenerator
{
	private static readonly string SnapshotDir = System.IO.Path.Combine(
		System.IO.Path.GetDirectoryName(typeof(SnapshotGenerator).Assembly.Location)!,
		"..", "..", "..", "Rendering", "Snapshots");

	[Fact]
	public void Capture_all_scenes()
	{
		if (System.Environment.GetEnvironmentVariable("SELVA_GENERATE_SNAPSHOTS") != "1") return;

		Directory.CreateDirectory(SnapshotDir);

		Save("single_path_curve.svg", SvgScenes.SinglePathCurve());
		Save("filled_surface.svg", SvgScenes.FilledSurface());
		Save("surface_with_holes.svg", SvgScenes.SurfaceWithHoles());
		Save("single_text.svg", SvgScenes.SingleText());
		Save("linear_dimension.svg", SvgScenes.LinearDimension());
		Save("angular_dimension.svg", SvgScenes.AngularDimension());
		Save("combined_path_text_dimension.svg", SvgScenes.CombinedPathTextDimension());
		Save("empty_document.svg", SvgScenes.EmptyDocument());
		Save("linear_dimension_breakline.svg", SvgScenes.LinearDimensionBreakLine());
		Save("symbol_dedupe.svg", SvgScenes.SymbolDedupe());
	}

	private static void Save(string name, string content)
	{
		var path = System.IO.Path.Combine(SnapshotDir, name);
		File.WriteAllText(path, content);
	}
}

// Shared by SnapshotGenerator and SvgRendererSnapshotTests so both build the same
// Document per scene.
internal static class SvgScenes
{
	private static SvgRenderer Renderer() => new SvgRenderer(new SvgRenderOptions
	{
		Padding = 10.0,
		AutoFitToContent = true,
	});

	public static string SinglePathCurve()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(10, 0).LineTo(10, 5).Close().Build();
		return Render(new[] { new PathElement { Path = path } });
	}

	public static string FilledSurface()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(20, 0).LineTo(20, 10).LineTo(0, 10).Close().Build();
		return Render(new[]
		{
			new PathElement
			{
				Path = path,
				Stroke = new Stroke { Color = Color.Rgb(0, 0, 0), Width = 0.25 },
				Fill = new Fill { Color = Color.Rgb((byte)200, (byte)200, (byte)200), Rule = FillRule.EvenOdd },
			},
		});
	}

	public static string SurfaceWithHoles()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(20, 0).LineTo(20, 10).LineTo(0, 10).Close()
			.MoveTo(5, 3).LineTo(15, 3).LineTo(15, 7).LineTo(5, 7).Close()
			.Build();
		return Render(new[]
		{
			new PathElement
			{
				Path = path,
				Fill = new Fill { Color = Color.Rgb(0.5f, 0.5f, 0.5f), Rule = FillRule.EvenOdd },
			},
		});
	}

	public static string SingleText()
	{
		return Render(new DrawElement[]
		{
			new TextElement
			{
				Text = "Hello",
				Position = new Point2D(5, 7),
				Style = new TextStyle
				{
					FontSize = 3.0,
					HorizontalAnchor = TextAnchor.Center,
					Color = Color.Rgb(0f, 0f, 0f),
				},
				MeasuredBounds = new BoundingBox(0, 5, 10, 9),
			},
		});
	}

	public static string LinearDimension()
	{
		return Render(new DrawElement[]
		{
			new DimensionElement
			{
				Kind = DimensionKind.Linear,
				A = new Point2D(0, 0),
				B = new Point2D(100, 0),
				Offset = 10,
				Style = new DimensionStyle
				{
					TextSize = 2.5,
					StrokeWidth = 0.25,
					Color = Color.Rgb(0f, 0f, 0f),
				},
			},
		});
	}

	public static string AngularDimension()
	{
		return Render(new DrawElement[]
		{
			new DimensionElement
			{
				Kind = DimensionKind.Angular,
				Vertex = new Point2D(0, 0),
				A = new Point2D(50, 0),
				B = new Point2D(0, 50),
				Style = new DimensionStyle
				{
					TextSize = 2.5,
					StrokeWidth = 0.25,
					Color = Color.Rgb(0f, 0f, 0f),
				},
			},
		});
	}

	public static string CombinedPathTextDimension()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(50, 0).LineTo(50, 25).LineTo(0, 25).Close().Build();
		return Render(new DrawElement[]
		{
			new PathElement { Path = path },
			new DimensionElement
			{
				Kind = DimensionKind.Linear,
				A = new Point2D(0, 0),
				B = new Point2D(50, 0),
				Offset = -8,
				Style = new DimensionStyle
				{
					TextSize = 2.5,
					StrokeWidth = 0.25,
					Color = Color.Rgb(0f, 0f, 0f),
				},
			},
			new TextElement
			{
				Text = "Plate",
				Position = new Point2D(25, 12.5),
				Style = new TextStyle
				{
					FontSize = 3.0,
					HorizontalAnchor = TextAnchor.Center,
					Color = Color.Rgb(0f, 0f, 0f),
				},
				MeasuredBounds = new BoundingBox(20, 11, 30, 14),
			},
		});
	}

	public static string LinearDimensionBreakLine()
	{
		// Pinned to catch regressions in the FontMetrics-based text-gap calculation.
		return Render(new DrawElement[]
		{
			new DimensionElement
			{
				Kind = DimensionKind.Linear,
				A = new Point2D(0, 0),
				B = new Point2D(100, 0),
				Offset = 10,
				Label = "100.00",
				Style = new DimensionStyle
				{
					TextSize = 2.5,
					StrokeWidth = 0.25,
					Color = Color.Rgb(0f, 0f, 0f),
					TextPlacement = DimensionTextPlacement.BreakLine,
					FontFamily = "Inter",
				},
			},
		});
	}

	public static string SymbolDedupe()
	{
		// One SymbolDefinition, three instances — pins that the renderer emits a single
		// <symbol> and three <use> refs instead of three inline copies.
		var triangle = new Path.Builder()
			.MoveTo(0, 0).LineTo(5, 0).LineTo(2.5, 4).Close().Build();
		var def = new SymbolDefinition
		{
			Id = "tri",
			Children = new DrawElement[] { new PathElement { Path = triangle } },
			ViewBox = new BoundingBox(0, 0, 5, 4),
		};
		return Render(new DrawElement[]
		{
			new SymbolElement { Definition = def, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = def, Position = new Point2D(20, 0) },
			new SymbolElement
			{
				Definition = def,
				Position = new Point2D(40, 0),
				Transform = Selva.Drawing.Model.Geometry.Transform.RotateDegrees(45),
			},
		});
	}

	public static string EmptyDocument()
	{
		var doc = new Document
		{
			Pages = new[] { new Page { Content = new GroupElement() } },
		};
		return Renderer().Render(doc);
	}

	private static string Render(System.Collections.Generic.IEnumerable<DrawElement> children)
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page
				{
					Content = new GroupElement { Children = System.Linq.Enumerable.ToArray(children) },
				},
			},
		};
		return Renderer().Render(doc);
	}
}
