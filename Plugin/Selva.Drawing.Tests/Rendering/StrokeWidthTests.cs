using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.Advanced;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Selva.Drawing.Rendering.Svg;
using Color = Selva.Drawing.Model.Style.Color;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering;

// Stroke.Width = 0 means "no stroke" in both renderers. The PDF spec defines the literal
// `0 w` operator as "thinnest line the output device can render", so a naive zero-width
// stroke would print at a different weight on every printer, viewer, and DPI. Suppressing
// the stroke instead of emitting `0 w` keeps the two renderers device-independent and in
// agreement with each other.
public class StrokeWidthTests
{
	private static readonly Path Line =
		new Path.Builder().MoveTo(10, 50).LineTo(100, 50).Build();

	private static readonly Path Square =
		new Path.Builder().MoveTo(0, 0).LineTo(50, 0).LineTo(50, 50).Close().Build();

	private static Document Doc(DrawElement content) =>
		new Document { Pages = new[] { new Page { Size = PaperSize.A4, Content = content } } };

	private static byte[] RenderPdf(DrawElement content) =>
		new PdfRenderer(new PdfRenderOptions { AutoFitToContent = false }).Render(Doc(content));

	private static string ContentStream(byte[] pdf)
	{
		using var ms = new MemoryStream(pdf);
		using var doc = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);
		var sb = new StringBuilder();
		foreach (var item in doc.Pages[0].Contents.Elements)
		{
			var stream = (item as PdfReference)?.Value as PdfDictionary;
			if (stream?.Stream != null)
				sb.Append(Encoding.Latin1.GetString(stream.Stream.UnfilteredValue));
		}
		return sb.ToString();
	}

	private static double[] LineWidths(string content)
	{
		var matches = Regex.Matches(content, @"([-\d.]+)\s+w\b");
		var widths = new double[matches.Count];
		for (var i = 0; i < matches.Count; i++)
			widths[i] = double.Parse(matches[i].Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
		return widths;
	}

	private static bool HasStrokeOperator(string content) =>
		Regex.IsMatch(content, @"(^|\s)(S|s|B|B\*|b|b\*)(\s|$)");

	// ============================================================================
	// Width = 0 suppresses the stroke
	// ============================================================================

	[Theory]
	[InlineData(0.0)]
	[InlineData(0.005)]
	[InlineData(Stroke.MinVisibleWidthMm)]
	public void Zero_width_is_not_stroked_in_pdf(double width)
	{
		var content = ContentStream(RenderPdf(
			new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = width } }));

		Assert.Empty(LineWidths(content));
		Assert.False(HasStrokeOperator(content), "path was stroked despite Width = 0");
	}

	[Theory]
	[InlineData(0.0)]
	[InlineData(0.005)]
	public void Zero_width_is_not_stroked_in_svg(double width)
	{
		var svg = new SvgRenderer().Render(Doc(
			new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = width } }));

		Assert.Contains("stroke='none'", svg);
		Assert.DoesNotContain("stroke-width=", svg);
	}

	[Fact]
	public void Zero_width_never_emits_the_device_dependent_operator()
	{
		var content = ContentStream(RenderPdf(
			new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = 0.0 } }));

		Assert.DoesNotMatch(@"(^|\s)0(\.0+)?\s+w\b", content);
	}

	[Fact]
	public void Zero_width_keeps_the_fill()
	{
		var content = ContentStream(RenderPdf(new PathElement
		{
			Path = Square,
			Stroke = new Stroke { Color = Color.Black, Width = 0.0 },
			Fill = new Fill { Color = Color.Rgb((byte)211, (byte)211, (byte)211) },
		}));

		Assert.Empty(LineWidths(content));
		// f/f* both fill (nonzero vs even-odd); the default fill rule emits f*.
		Assert.Matches(@"(^|\s)f\*?(\s|$)", content);
		Assert.False(HasStrokeOperator(content), "outline was drawn despite Width = 0");
	}

	[Theory]
	[InlineData(LineWeight.Thin)]
	[InlineData(LineWeight.Fine)]
	[InlineData(LineWeight.Heavy)]
	public void Visible_widths_pass_through_unchanged(double width)
	{
		var content = ContentStream(RenderPdf(
			new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = width } }));

		Assert.Contains(width, LineWidths(content));
		Assert.True(HasStrokeOperator(content));
	}

	// The unstyled fallback keys off Stroke being absent, not off the pen being null: keying
	// it off the pen would hand a suppressed outline back the default weight, exactly the
	// outline the caller asked to remove.
	[Fact]
	public void Zero_width_does_not_fall_back_to_the_default_line()
	{
		var content = ContentStream(RenderPdf(
			new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = 0.0 } }));

		Assert.DoesNotContain(Stroke.UnstyledPathWidthMm, LineWidths(content));
	}

	[Fact]
	public void Zero_width_stays_suppressed_at_every_view_scale()
	{
		foreach (var viewScale in new[] { 1.0, 0.1, 0.02 })
		{
			var view = new DrawingView
			{
				Scale = viewScale,
				Geometry = new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = 0.0 } },
			}.Resolve(new LayoutContext(new BoundingBox(0, 0, 210, 297)));

			var content = ContentStream(RenderPdf(view));
			Assert.Empty(LineWidths(content));
		}
	}

	[Fact]
	public void Zero_width_does_not_inflate_bounds()
	{
		var element = new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = 0.0 } };
		var bounds = element.ComputeBounds();

		Assert.Equal(50, bounds.MinY, precision: 6);
		Assert.Equal(50, bounds.MaxY, precision: 6);
	}

	// ============================================================================
	// Cross-renderer agreement
	// ============================================================================

	[Theory]
	[InlineData(0.0)]
	[InlineData(0.25)]
	[InlineData(1.0)]
	public void Svg_and_pdf_agree_on_stroke_width(double width)
	{
		var element = new PathElement { Path = Line, Stroke = new Stroke { Color = Color.Black, Width = width } };
		var pdfWidths = LineWidths(ContentStream(RenderPdf(element)));
		var svgWidth = Regex.Match(new SvgRenderer().Render(Doc(element)), @"stroke-width='([\d.]+)'");

		if (!Stroke.IsVisibleWidth(width))
		{
			Assert.Empty(pdfWidths);
			Assert.False(svgWidth.Success);
			return;
		}

		Assert.Equal(
			Assert.Single(pdfWidths),
			double.Parse(svgWidth.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
			precision: 6);
	}

	// Regression: an unstyled path used to render 0.25mm in PDF but 1.0mm in SVG, because
	// only the PDF renderer named a width; SVG omitted the attribute and inherited its spec
	// default of 1.0mm.
	[Fact]
	public void Unstyled_path_has_the_same_width_in_both_renderers()
	{
		var element = new PathElement { Path = Line };

		var pdfWidth = Assert.Single(LineWidths(ContentStream(RenderPdf(element))));
		var svgWidth = Regex.Match(
			new SvgRenderer().Render(Doc(element)), @"stroke='black'\s+stroke-width='([\d.]+)'");

		Assert.True(svgWidth.Success, "SVG omitted the width, so it inherits the 1.0 mm spec default");
		Assert.Equal(Stroke.UnstyledPathWidthMm, pdfWidth, precision: 6);
		Assert.Equal(
			pdfWidth,
			double.Parse(svgWidth.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
			precision: 6);
	}

	[Theory]
	[InlineData(1.0)]
	[InlineData(0.5)]
	public void Hatch_pattern_width_agrees_across_renderers(double patternScale)
	{
		var element = new PathElement
		{
			Path = Square,
			Fill = new Fill { Color = Color.Black, Pattern = HatchPattern.Lines, PatternScale = patternScale },
		};

		var expected = Math.Max(Stroke.HatchPatternWidthMm * patternScale, Stroke.MinVisibleWidthMm * 2);
		Assert.All(LineWidths(ContentStream(RenderPdf(element))), w => Assert.Equal(expected, w, precision: 6));

		var svgWidths = Regex.Matches(new SvgRenderer().Render(Doc(element)), @"stroke-width='([\d.]+)'");
		Assert.NotEmpty(svgWidths);
		Assert.All(svgWidths, m => Assert.Equal(
			expected,
			double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
			precision: 6));
	}

	// Hatch widths are generated from PatternScale rather than authored, so a tiny scale must
	// not silently erase the pattern, nor emit `0 w`.
	[Fact]
	public void Tiny_pattern_scale_still_draws_a_visible_pattern()
	{
		var content = ContentStream(RenderPdf(new PathElement
		{
			Path = Square,
			Fill = new Fill { Color = Color.Black, Pattern = HatchPattern.Lines, PatternScale = 0.001 },
		}));

		var widths = LineWidths(content);
		Assert.NotEmpty(widths);
		Assert.All(widths, w => Assert.True(Stroke.IsVisibleWidth(w), $"emitted '{w} w'"));
	}

	[Fact]
	public void Zero_width_dimension_keeps_its_label()
	{
		var content = ContentStream(RenderPdf(new DimensionElement
		{
			Kind = DimensionKind.Linear,
			A = new Point2D(0, 0),
			B = new Point2D(100, 0),
			Offset = 10,
			Style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.0 },
		}));

		Assert.Empty(LineWidths(content));
		Assert.Contains("Tj", content); // text-showing operator
	}
}
