using System.IO;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Color = Selva.Drawing.Model.Style.Color;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Hatch coverage for the PDF renderer. Two paths exercise the same machinery:
//   * PathElement with Fill.Pattern != None - the user-facing path used by GH_PathStyle.
//   * HatchElement - the model's first-class hatched-region element.
// PdfSharpCore stamps dates and trailer IDs into every file, so we can't byte-snapshot;
// instead we check structural validity and that hatched output is larger than stroke-only,
// proving pattern strokes actually reached the page content.
public class PdfHatchTests
{
	private static byte[] RenderScene(DrawElement content)
	{
		var doc = new Document
		{
			Pages = new[] { new Page { Content = content } },
		};
		return new PdfRenderer().Render(doc);
	}

	private static Path Square(double size = 50.0)
	{
		return new Path.Builder()
			.MoveTo(0, 0)
			.LineTo(size, 0)
			.LineTo(size, size)
			.LineTo(0, size)
			.Close()
			.Build();
	}

	[Theory]
	[InlineData(HatchPattern.Lines)]
	[InlineData(HatchPattern.CrossHatch)]
	[InlineData(HatchPattern.Dots)]
	[InlineData(HatchPattern.Brick)]
	public void PathElement_with_pattern_renders_a_valid_pdf(HatchPattern pattern)
	{
		var element = new PathElement
		{
			Path = Square(),
			Stroke = new Stroke { Color = Color.Black, Width = 0.5 },
			Fill = new Fill { Color = Color.Black, Pattern = pattern },
		};

		var bytes = RenderScene(element);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
		Assert.True(bytes.Length > 0);
	}

	[Fact]
	public void Hatched_fill_emits_more_content_than_stroke_only()
	{
		// Same boundary and stroke; hatched must be strictly larger since pattern strokes
		// are emitted in addition to the boundary. Regression check for the pattern path
		// silently discarding its strokes.
		var strokeOnly = new PathElement
		{
			Path = Square(),
			Stroke = new Stroke { Color = Color.Black, Width = 0.5 },
		};
		var hatched = new PathElement
		{
			Path = Square(),
			Stroke = new Stroke { Color = Color.Black, Width = 0.5 },
			Fill = new Fill { Color = Color.Black, Pattern = HatchPattern.CrossHatch },
		};

		var strokeOnlyBytes = RenderScene(strokeOnly);
		var hatchedBytes = RenderScene(hatched);

		Assert.True(hatchedBytes.Length > strokeOnlyBytes.Length,
			$"Expected hatched PDF ({hatchedBytes.Length} bytes) > stroke-only ({strokeOnlyBytes.Length} bytes).");
	}

	[Fact]
	public void Pattern_scale_changes_content_size()
	{
		// Higher PatternScale means fewer lines emitted for the same square, so byte
		// sizes should differ. Regression check that PatternScale is actually read.
		var dense = new PathElement
		{
			Path = Square(),
			Fill = new Fill { Color = Color.Black, Pattern = HatchPattern.Lines, PatternScale = 1.0 },
		};
		var sparse = new PathElement
		{
			Path = Square(),
			Fill = new Fill { Color = Color.Black, Pattern = HatchPattern.Lines, PatternScale = 4.0 },
		};

		var denseBytes = RenderScene(dense);
		var sparseBytes = RenderScene(sparse);

		Assert.NotEqual(denseBytes.Length, sparseBytes.Length);
	}

	[Theory]
	[InlineData(HatchPatternKind.Solid)]
	[InlineData(HatchPatternKind.Lines)]
	[InlineData(HatchPatternKind.CrossHatch)]
	[InlineData(HatchPatternKind.Dots)]
	public void HatchElement_renders_a_valid_pdf(HatchPatternKind kind)
	{
		var element = new HatchElement
		{
			Boundary = Square(),
			Pattern = kind,
			Spacing = 2.0,
			AngleDegrees = 45.0,
			LineStyle = new Stroke { Color = Color.Black, Width = 0.18 },
		};

		var bytes = RenderScene(element);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
		Assert.True(bytes.Length > 0);
	}

	[Fact]
	public void HatchElement_with_background_emits_more_content()
	{
		var noBg = new HatchElement
		{
			Boundary = Square(),
			Pattern = HatchPatternKind.Lines,
			Spacing = 2.0,
		};
		var withBg = new HatchElement
		{
			Boundary = Square(),
			Pattern = HatchPatternKind.Lines,
			Spacing = 2.0,
			BackgroundColor = Color.Rgb(220, 220, 220),
		};

		var noBgBytes = RenderScene(noBg);
		var withBgBytes = RenderScene(withBg);

		Assert.True(withBgBytes.Length > noBgBytes.Length);
	}

	[Fact]
	public void Empty_hatch_boundary_renders_without_throwing()
	{
		var element = new HatchElement
		{
			Boundary = Path.Empty,
			Pattern = HatchPatternKind.Lines,
		};
		var bytes = RenderScene(element);
		Assert.True(bytes.Length > 0);
	}
}
