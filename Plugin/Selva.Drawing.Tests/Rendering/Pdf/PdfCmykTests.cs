using System.IO;
using System.Text;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.Advanced;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Color = Selva.Drawing.Model.Style.Color;
using Path = Selva.Drawing.Model.Geometry.Path;
using PdfColorMode = Selva.Drawing.Rendering.Pdf.PdfColorMode;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// CMYK colours must flow through to the rendered PDF as device-CMYK ink values without
// an RGB round-trip — /DeviceRGB output causes preflight warnings in Acrobat for print work.
public class PdfCmykTests
{
	[Fact]
	public void Cmyk_fill_emits_device_cmyk_in_content_stream()
	{
		// A saturated red-orange, nowhere near any default RGB colour, so the byte
		// signature is unambiguous.
		var fill = new Fill { Color = Color.Cmyk(0.0f, 1.0f, 0.6f, 0.0f) };
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(50, 0).LineTo(50, 30).LineTo(0, 30).Close().Build();
		var doc = new Document
		{
			Pages = new[]
			{
				new Page
				{
					Content = new PathElement
					{
						Path = path,
						Fill = fill,
						Stroke = new Stroke { Color = Color.Cmyk(1.0f, 0.0f, 0.0f, 0.0f), Width = 0.5 },
					},
				},
			},
		};

		// PdfSharpCore has no per-page override: this forces every content-stream
		// colour operator to /DeviceCMYK for the whole document.
		var bytes = new PdfRenderer(new PdfRenderOptions { ColorMode = PdfColorMode.Cmyk }).Render(doc);

		// Reopen as Modify to read the content stream's UnfilteredValue (may be
		// Flate-compressed). PdfSharpCore writes CMYK via `k`/`K` (fill/stroke) operators.
		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);
		Assert.Equal(1, reopened.PageCount);

		var page = reopened.Pages[0];
		var contents = page.Contents;
		var sb = new StringBuilder();
		foreach (PdfItem item in contents.Elements.Items)
		{
			if (item is PdfReference reference && reference.Value is PdfDictionary stream && stream.Stream != null)
			{
				sb.Append(Encoding.GetEncoding(28591).GetString(stream.Stream.UnfilteredValue));
			}
		}
		var content = sb.ToString();
		var hasCmykSignature =
			content.Contains(" k\n") || content.Contains(" k ") ||
			content.Contains(" K\n") || content.Contains(" K ");
		Assert.True(hasCmykSignature,
			"Rendered PDF content stream should contain a CMYK fill (k) or stroke (K) operator. Got: " + content);
	}

	[Fact]
	public void Default_color_mode_emits_device_rgb_operators()
	{
		// Default mode is RGB; a CMYK source colour still converts on emit.
		var fill = new Fill { Color = Color.Cmyk(0.0f, 1.0f, 0.6f, 0.0f) };
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(50, 0).LineTo(50, 30).LineTo(0, 30).Close().Build();
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Content = new PathElement { Path = path, Fill = fill } },
			},
		};

		var bytes = new PdfRenderer().Render(doc);
		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);
		var page = reopened.Pages[0];
		var contents = page.Contents;
		var sb = new StringBuilder();
		foreach (PdfItem item in contents.Elements.Items)
		{
			if (item is PdfReference reference && reference.Value is PdfDictionary stream && stream.Stream != null)
			{
				sb.Append(Encoding.GetEncoding(28591).GetString(stream.Stream.UnfilteredValue));
			}
		}
		var content = sb.ToString();
		var hasRgbSignature =
			content.Contains(" rg\n") || content.Contains(" rg ") ||
			content.Contains(" RG\n") || content.Contains(" RG ");
		Assert.True(hasRgbSignature, "Default mode should emit RGB operators. Got: " + content);
	}
}
