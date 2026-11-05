using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using PdfSharp.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Production documents are compared and archived by content: the same drawing must give the same bytes.
public class PdfDeterminismTests
{
	private static Document Sample(DateTime? createdAt = null, string title = "upstream stream title", string text = "Regular") => new()
	{
		Metadata = new DocumentMetadata { Title = title, CreatedAt = createdAt ?? new DateTime(2026, 1, 1) },
		Pages = new[]
		{
			new Page
			{
				Content = new GroupElement
				{
					Children = new DrawElement[]
					{
						new TextElement { Text = text, Position = new Point2D(10, 10), Style = new TextStyle { FontSize = 4 } },
						new TextElement
						{
							Text = "Bold", Position = new Point2D(10, 20),
							Style = new TextStyle { FontSize = 4, Weight = FontWeight.Bold },
						},
					},
				},
			},
		},
	};

	[Fact]
	public void The_same_document_renders_to_the_same_bytes()
	{
		var first = new PdfRenderer().Render(Sample());
		var second = new PdfRenderer().Render(Sample());

		Assert.Equal(first, second);
	}

	[Fact]
	public void Without_a_creation_date_the_bytes_still_match()
	{
		static Document Undated() => new()
		{
			Pages = Sample().Pages,
		};

		var first = new PdfRenderer().Render(Undated());
		var second = new PdfRenderer().Render(Undated());

		Assert.Equal(first, second);
		Assert.DoesNotContain("/CreationDate", Encoding.ASCII.GetString(first));
	}

	[Fact]
	public void Different_glyph_subsets_get_different_tags()
	{
		static Dictionary<string, string> Tags(string text)
		{
			var pdf = Encoding.ASCII.GetString(new PdfRenderer().Render(Sample(text: text)));
			var tags = new Dictionary<string, string>();
			foreach (Match m in Regex.Matches(pdf, @"/BaseFont\s*/([A-Z]{6})\+([^\s/>\]]+)")) tags[m.Groups[2].Value] = m.Groups[1].Value;
			return tags;
		}

		var a = Tags("abc");
		var b = Tags("xyz");

		// The regular face carries the differing text; the bold face renders "Bold" in both.
		Assert.Equal(a.Keys.OrderBy(k => k), b.Keys.OrderBy(k => k));
		Assert.Contains(a, kv => b[kv.Key] != kv.Value);
		Assert.Contains(a, kv => b[kv.Key] == kv.Value);
	}

	[Fact]
	public void Metadata_that_looks_like_a_subset_tag_is_left_alone()
	{
		var bytes = new PdfRenderer().Render(Sample(title: "Sheet /ABCDEF+A1"));

		using var reopened = PdfReader.Open(new MemoryStream(bytes), PdfDocumentOpenMode.Import);
		Assert.Equal("Sheet /ABCDEF+A1", reopened.Info.Title);
	}

	[Fact]
	public void A_stream_body_holding_endstream_is_skipped_by_its_length()
	{
		const string body = "x endstream /ABCDEF+Foo y";
		var pdf = Encoding.ASCII.GetBytes(
			$"1 0 obj\n<< /Length {body.Length} >>\nstream\n{body}\nendstream\nendobj\n");

		PdfDeterminism.Apply(pdf);

		Assert.Contains(body, Encoding.ASCII.GetString(pdf));
	}

	[Fact]
	public void The_rewritten_file_still_opens_with_its_fonts_and_id()
	{
		var bytes = new PdfRenderer().Render(Sample());
		var text = Encoding.ASCII.GetString(bytes);

		Assert.Matches(new Regex(@"/BaseFont\s*/[A-Z]{6}\+Inter"), text);
		Assert.Matches(new Regex(@"/ID\s*\[<[0-9A-F]{32}><[0-9A-F]{32}>\]"), text);
		Assert.DoesNotContain("<00000000000000000000000000000000>", text);

		using var reopened = PdfReader.Open(new MemoryStream(bytes), PdfDocumentOpenMode.Import);
		Assert.Equal(1, reopened.PageCount);
	}
}
