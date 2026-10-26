using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Selva.Drawing.Model;

namespace Selva.Drawing.Rendering.Pdf;

// Builds the XMP packet (RDF/XML) for the document's /Metadata stream, mirroring the /Info
// fields: DAMs and PDF/A or PDF/X readers expect XMP. PdfObjectRewriter puts it in place of the
// packet PDFsharp writes, which leaves values unescaped and stamps random UUIDs.
internal static class PdfXmpMetadata
{
	// Public so tests can check the RDF/XML directly, without round-tripping a full PDF.
	public static string BuildPacket(DocumentMetadata metadata)
	{
		var sb = new StringBuilder();
		// "W5M0MpCehiHzreSzNTczkc9d" is the fixed XMP sentinel UUID readers scan for to
		// locate the packet — don't change it.
		sb.Append("<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n");
		sb.Append("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Selva.Drawing\">\n");
		sb.Append("<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n");
		sb.Append("<rdf:Description rdf:about=\"\"\n");
		sb.Append("    xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n");
		sb.Append("    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n");
		sb.Append("    xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\">\n");

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

		sb.Append("  <pdf:Producer>");
		sb.Append(Escape(PdfInfo.ProducerOf(metadata)));
		sb.Append("</pdf:Producer>\n");
		var keywords = PdfInfo.JoinKeywords(metadata.Keywords);
		if (keywords != null)
		{
			sb.Append("  <pdf:Keywords>");
			sb.Append(Escape(keywords));
			sb.Append("</pdf:Keywords>\n");
		}

		sb.Append("</rdf:Description>\n");
		sb.Append("</rdf:RDF>\n");
		sb.Append("</x:xmpmeta>\n");
		// Padding lets a DAM rewrite the packet in place later without growing the file.
		sb.Append(new string(' ', 1024));
		sb.Append("\n<?xpacket end=\"w\"?>");
		return sb.ToString();
	}


	private static string FormatDate(DateTime dt)
	{
		// Unspecified is treated as UTC. ISO 8601: UTC gets "Z", everything else its offset.
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
