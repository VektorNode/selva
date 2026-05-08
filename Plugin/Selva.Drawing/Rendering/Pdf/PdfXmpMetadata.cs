using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.Advanced;
using Selva.Drawing.Model;

namespace Selva.Drawing.Rendering.Pdf;

// Phase 9: emits an XMP packet (RDF/XML) and attaches it as the document's /Metadata
// stream. PDF readers and document-management systems (DAMs) prefer XMP over the legacy
// /Info dictionary because it survives copy-paste, supports namespaces, and is the only
// metadata channel PDF/A and PDF/X recognise. PdfSharpCore writes /Info automatically;
// we mirror the same fields into the XMP packet so both stay consistent.
//
// The packet follows the XMP specification (ISO 16684-1) — three required sections:
// <?xpacket begin?> framing, an <x:xmpmeta> envelope, and an <rdf:RDF> body. Inside RDF
// each metadata schema lives in its own namespace (dc/, xmp/, pdf/) on the root
// rdf:Description.
internal static class PdfXmpMetadata
{
	public static void Attach(PdfDocument pdf, DocumentMetadata metadata)
	{
		if (pdf == null || metadata == null) return;

		var xmp = BuildPacket(metadata);
		var bytes = Encoding.UTF8.GetBytes(xmp);

		var stream = new PdfDictionary(pdf);
		stream.Elements.SetName("/Type", "/Metadata");
		stream.Elements.SetName("/Subtype", "/XML");
		stream.CreateStream(bytes);

		pdf.Internals.AddObject(stream);
		pdf.Internals.Catalog.Elements["/Metadata"] = stream.Reference;
	}

	// Public for unit tests — verifies the RDF/XML is well-formed and contains the expected
	// fields without round-tripping through a full PDF.
	public static string BuildPacket(DocumentMetadata metadata)
	{
		var sb = new StringBuilder();
		// xpacket sentinel — readers detect XMP by these magic bytes regardless of where in
		// the stream they appear. The "W5M0MpCehiHzreSzNTczkc9d" UUID is required by the spec.
		sb.Append("<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n");
		sb.Append("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Selva.Drawing\">\n");
		sb.Append("<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n");
		sb.Append("<rdf:Description rdf:about=\"\"\n");
		sb.Append("    xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n");
		sb.Append("    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n");
		sb.Append("    xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\">\n");

		// Dublin Core (dc:): title, creator, description, subject (keywords).
		if (!string.IsNullOrEmpty(metadata.Title))
		{
			sb.Append("  <dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">");
			sb.Append(Escape(metadata.Title));
			sb.Append("</rdf:li></rdf:Alt></dc:title>\n");
		}
		if (!string.IsNullOrEmpty(metadata.Author))
		{
			sb.Append("  <dc:creator><rdf:Seq><rdf:li>");
			sb.Append(Escape(metadata.Author));
			sb.Append("</rdf:li></rdf:Seq></dc:creator>\n");
		}
		if (!string.IsNullOrEmpty(metadata.Subject))
		{
			sb.Append("  <dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">");
			sb.Append(Escape(metadata.Subject));
			sb.Append("</rdf:li></rdf:Alt></dc:description>\n");
		}
		if (metadata.Keywords != null && metadata.Keywords.Count > 0)
		{
			sb.Append("  <dc:subject><rdf:Bag>\n");
			foreach (var keyword in metadata.Keywords)
			{
				if (string.IsNullOrEmpty(keyword)) continue;
				sb.Append("    <rdf:li>");
				sb.Append(Escape(keyword));
				sb.Append("</rdf:li>\n");
			}
			sb.Append("  </rdf:Bag></dc:subject>\n");
		}

		// XMP basic schema (xmp:): creator tool, create date, modify date.
		if (!string.IsNullOrEmpty(metadata.Creator))
		{
			sb.Append("  <xmp:CreatorTool>");
			sb.Append(Escape(metadata.Creator));
			sb.Append("</xmp:CreatorTool>\n");
		}
		if (metadata.CreatedAt.HasValue)
		{
			sb.Append("  <xmp:CreateDate>");
			sb.Append(FormatDate(metadata.CreatedAt.Value));
			sb.Append("</xmp:CreateDate>\n");
		}
		if (metadata.ModifiedAt.HasValue)
		{
			sb.Append("  <xmp:ModifyDate>");
			sb.Append(FormatDate(metadata.ModifiedAt.Value));
			sb.Append("</xmp:ModifyDate>\n");
		}

		// PDF schema (pdf:): producer, keywords (comma-separated to mirror /Info).
		if (!string.IsNullOrEmpty(metadata.Producer))
		{
			sb.Append("  <pdf:Producer>");
			sb.Append(Escape(metadata.Producer));
			sb.Append("</pdf:Producer>\n");
		}
		if (metadata.Keywords != null && metadata.Keywords.Count > 0)
		{
			sb.Append("  <pdf:Keywords>");
			sb.Append(Escape(string.Join("; ", FilterEmpty(metadata.Keywords))));
			sb.Append("</pdf:Keywords>\n");
		}

		sb.Append("</rdf:Description>\n");
		sb.Append("</rdf:RDF>\n");
		sb.Append("</x:xmpmeta>\n");
		// Trailing whitespace + xpacket end. The padding gives DAMs a chance to rewrite
		// the packet in place without growing the file (recommended by the XMP spec).
		sb.Append(new string(' ', 1024));
		sb.Append("\n<?xpacket end=\"w\"?>");
		return sb.ToString();
	}

	private static IEnumerable<string> FilterEmpty(IReadOnlyList<string> values)
	{
		foreach (var v in values) if (!string.IsNullOrEmpty(v)) yield return v;
	}

	private static string FormatDate(DateTime dt)
	{
		// XMP dates use ISO 8601 with timezone — UTC datetimes get a "Z", others get the
		// local offset. Same convention PDF /Info uses internally.
		var utc = dt.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(dt, DateTimeKind.Utc) : dt;
		return utc.Kind == DateTimeKind.Utc
			? utc.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)
			: utc.ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
	}

	private static string Escape(string s)
	{
		if (string.IsNullOrEmpty(s)) return string.Empty;
		var sb = new StringBuilder(s.Length);
		foreach (var c in s)
		{
			switch (c)
			{
				case '&': sb.Append("&amp;"); break;
				case '<': sb.Append("&lt;"); break;
				case '>': sb.Append("&gt;"); break;
				case '"': sb.Append("&quot;"); break;
				case '\'': sb.Append("&apos;"); break;
				default: sb.Append(c); break;
			}
		}
		return sb.ToString();
	}
}
