using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Selva.Drawing.Model;

namespace Selva.Drawing.Rendering.Pdf;

// The document /Info dictionary, written by PdfObjectRewriter in place of PDFsharp's. PDFsharp
// rewrites a caller's Producer to "PDFsharp 6.2.4 (Original: X)", which would then disagree with
// the XMP packet. No date given, no date written: a stamped DateTime.Now makes every render differ.
internal static class PdfInfo
{
	internal const string DefaultProducer = "PDFsharp";

	public static string Build(DocumentMetadata metadata)
	{
		metadata ??= new DocumentMetadata();
		var sb = new StringBuilder("<<");
		Append(sb, "/Title", metadata.Title);
		Append(sb, "/Author", metadata.Author);
		Append(sb, "/Subject", metadata.Subject);
		Append(sb, "/Keywords", JoinKeywords(metadata.Keywords));
		Append(sb, "/Creator", metadata.Creator);
		Append(sb, "/Producer", ProducerOf(metadata));
		if (metadata.CreatedAt.HasValue) Append(sb, "/CreationDate", FormatDate(metadata.CreatedAt.Value));
		if (metadata.ModifiedAt.HasValue) Append(sb, "/ModDate", FormatDate(metadata.ModifiedAt.Value));
		sb.Append(">>");
		return sb.ToString();
	}

	// Shared with the XMP packet so /Info and XMP never disagree.
	internal static string ProducerOf(DocumentMetadata metadata) =>
		string.IsNullOrEmpty(metadata.Producer) ? DefaultProducer : metadata.Producer;

	// Null when there are no non-empty keywords.
	internal static string JoinKeywords(IReadOnlyList<string> keywords)
	{
		if (keywords == null) return null;
		var kept = new List<string>(keywords.Count);
		foreach (var k in keywords) if (!string.IsNullOrEmpty(k)) kept.Add(k);
		return kept.Count == 0 ? null : string.Join("; ", kept);
	}

	private static void Append(StringBuilder sb, string key, string value)
	{
		if (string.IsNullOrEmpty(value)) return;
		sb.Append(key).Append(TextString(value));
	}

	// Printable ASCII as a literal string; anything else as UTF-16BE with a byte-order mark,
	// the one encoding every reader decodes for text strings.
	internal static string TextString(string value)
	{
		var ascii = true;
		foreach (var c in value)
			if (c < 0x20 || c > 0x7E) { ascii = false; break; }

		var sb = new StringBuilder(value.Length + 8);
		if (ascii)
		{
			sb.Append('(');
			foreach (var c in value)
			{
				if (c is '(' or ')' or '\\') sb.Append('\\');
				sb.Append(c);
			}
			return sb.Append(')').ToString();
		}

		sb.Append("<FEFF");
		foreach (var c in value) sb.Append(((int)c).ToString("X4", CultureInfo.InvariantCulture));
		return sb.Append('>').ToString();
	}

	// "D:YYYYMMDDHHmmSS" plus "Z" or "+HH'mm'". Unspecified is treated as UTC, as in the XMP packet.
	private static string FormatDate(DateTime dt)
	{
		var date = dt.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(dt, DateTimeKind.Utc) : dt;
		var stamp = "D:" + date.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
		if (date.Kind == DateTimeKind.Utc) return stamp + "Z";

		var offset = TimeZoneInfo.Local.GetUtcOffset(date);
		var sign = offset < TimeSpan.Zero ? '-' : '+';
		offset = offset.Duration();
		return stamp + sign + offset.Hours.ToString("00", CultureInfo.InvariantCulture) + "'"
			+ offset.Minutes.ToString("00", CultureInfo.InvariantCulture) + "'";
	}
}
