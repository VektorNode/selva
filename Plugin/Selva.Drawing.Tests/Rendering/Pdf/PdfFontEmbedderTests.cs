using System;
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

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Regression test for white-text-in-PDF: inside Rhino, GlobalFontSettings.FontResolver
// is already set before our PdfRenderer runs, and Rhino's resolver substitutes "Inter"
// with a fallback font that's mostly .notdef glyphs. EnsureInstalled wraps whatever
// resolver is already there so Inter requests come to us first.
public class PdfFontEmbedderTests
{
	[Fact]
	public void Renders_visible_glyph_ids_for_inter_text()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page
				{
					Content = new TextElement
					{
						Text = "HELLO",
						Position = new Point2D(50, 50),
						Style = new TextStyle { FontSize = 5, Color = Color.Black, FontFamily = "Inter" },
					},
				},
			},
		};
		var bytes = new PdfRenderer().Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);
		var page = reopened.Pages[0];
		var sb = new StringBuilder();
		foreach (PdfItem item in page.Contents.Elements.Items)
		{
			if (item is PdfReference reference && reference.Value is PdfDictionary stream && stream.Stream != null)
				sb.Append(Encoding.GetEncoding(28591).GetString(stream.Stream.UnfilteredValue));
		}
		var content = sb.ToString();

		// Find the Tj hex operand and assert it isn't all-zeros (.notdef). We don't pin
		// exact glyph IDs since they depend on the Inter version, just that they're set.
		var tjStart = content.IndexOf('<');
		var tjEnd = content.IndexOf('>', tjStart + 1);
		Assert.True(tjStart > 0 && tjEnd > tjStart, $"No Tj hex string found:\n{content}");
		var hex = content.Substring(tjStart + 1, tjEnd - tjStart - 1);
		Assert.True(hex.Length >= 4, $"Tj hex too short: {hex}");
		Assert.False(IsAllZeros(hex), $"All glyphs are .notdef (white text bug): {hex}");
	}

	private static bool IsAllZeros(string hex)
	{
		foreach (var c in hex) if (c != '0') return false;
		return true;
	}
}
