using System;
using System.IO;
using System.Text;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.Advanced;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Rendering.Pdf;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Phase 9: XMP metadata is the modern, preflight-friendly metadata channel for PDFs
// (DAMs, PDF/A, PDF/X all rely on it). The legacy /Info dictionary is still emitted
// alongside; XMP is additive.
public class PdfXmpMetadataTests
{
	[Fact]
	public void Build_packet_contains_dublin_core_title_and_creator()
	{
		var meta = new DocumentMetadata
		{
			Title = "Bracket assembly",
			Author = "Felix",
			Subject = "Mechanical drawing",
			Keywords = new[] { "bracket", "assembly", "test" },
			Creator = "Selva",
			Producer = "Selva.Drawing",
			CreatedAt = new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc),
		};
		var packet = PdfXmpMetadata.BuildPacket(meta);

		Assert.Contains("<?xpacket begin=", packet);
		Assert.Contains("<?xpacket end=\"w\"?>", packet);
		Assert.Contains("xmlns:dc=\"http://purl.org/dc/elements/1.1/\"", packet);
		Assert.Contains("Bracket assembly", packet);
		Assert.Contains("<dc:creator><rdf:Seq><rdf:li>Felix", packet);
		Assert.Contains("<dc:subject><rdf:Bag>", packet);
		Assert.Contains("<rdf:li>bracket</rdf:li>", packet);
		Assert.Contains("<xmp:CreatorTool>Selva</xmp:CreatorTool>", packet);
		Assert.Contains("<pdf:Producer>Selva.Drawing</pdf:Producer>", packet);
		Assert.Contains("<xmp:CreateDate>2026-04-30T12:00:00Z</xmp:CreateDate>", packet);
	}

	[Fact]
	public void Build_packet_escapes_special_xml_characters()
	{
		var meta = new DocumentMetadata { Title = "<bracket> & \"plate\"" };
		var packet = PdfXmpMetadata.BuildPacket(meta);
		Assert.Contains("&lt;bracket&gt; &amp; &quot;plate&quot;", packet);
		Assert.DoesNotContain("<bracket>", packet);
	}

	[Fact]
	public void Rendered_pdf_attaches_metadata_stream_to_catalog()
	{
		var doc = new Document
		{
			Metadata = new DocumentMetadata { Title = "Bracket assembly", Author = "Felix" },
			Pages = new[] { new Page { Content = new GroupElement() } },
		};
		var bytes = new PdfRenderer().Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		var catalog = reopened.Internals.Catalog;
		var metadataItem = catalog.Elements["/Metadata"];
		Assert.NotNull(metadataItem);

		var metadataObj = metadataItem is PdfReference reference
			? reference.Value as PdfDictionary
			: metadataItem as PdfDictionary;
		Assert.NotNull(metadataObj);
		Assert.Equal("/Metadata", metadataObj.Elements.GetName("/Type"));
		Assert.Equal("/XML", metadataObj.Elements.GetName("/Subtype"));

		var streamBytes = metadataObj.Stream.UnfilteredValue;
		Assert.NotNull(streamBytes);
		var packet = Encoding.UTF8.GetString(streamBytes);
		Assert.Contains("Bracket assembly", packet);
	}

	[Fact]
	public void Disable_xmp_skips_metadata_attachment()
	{
		var doc = new Document
		{
			Metadata = new DocumentMetadata { Title = "No XMP" },
			Pages = new[] { new Page { Content = new GroupElement() } },
		};
		var bytes = new PdfRenderer(new PdfRenderOptions { EmitXmpMetadata = false }).Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.False(reopened.Internals.Catalog.Elements.ContainsKey("/Metadata"));
	}
}
