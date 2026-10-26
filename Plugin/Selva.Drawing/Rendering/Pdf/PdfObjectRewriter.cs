using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Selva.Drawing.Rendering.Pdf;

// PDFsharp 6 regenerates /Info and the XMP stream inside Save() with no opt-out, so both are
// replaced after the save: objects are located through PDFsharp's own cross-reference table,
// copied in order with the two swapped, and the table rebuilt. This relies on the classic xref
// layout PDFsharp writes (no object streams, no incremental updates); PDFsharp is pinned at 6.2.4,
// so that layout cannot change under us. Any surprise returns the input untouched.
internal static class PdfObjectRewriter
{
	private static readonly Encoding Latin1 = Encoding.GetEncoding("ISO-8859-1");
	private static readonly Regex TrailerInfo = new(@"/Info\s*(\d+)\s+0\s+R");
	private static readonly Regex TrailerRoot = new(@"/Root\s*(\d+)\s+0\s+R");
	private static readonly Regex CatalogMetadata = new(@"/Metadata\s*(\d+)\s+0\s+R");

	// xmp == null drops /Metadata from the catalog; the object it pointed at becomes null.
	public static byte[] ReplaceInfoAndMetadata(byte[] pdf, string info, byte[] xmp)
	{
		var tailFrom = Math.Max(0, pdf.Length - 64);
		var tail = Latin1.GetString(pdf, tailFrom, pdf.Length - tailFrom);
		var startxref = tail.LastIndexOf("startxref", StringComparison.Ordinal);
		if (startxref < 0) return pdf;
		var xrefAt = ParseInt(tail, startxref + "startxref".Length);
		if (xrefAt <= 0 || xrefAt >= pdf.Length) return pdf;

		// The table and trailer: 20 bytes per object, small next to the content.
		var table = Latin1.GetString(pdf, xrefAt, pdf.Length - xrefAt);
		if (!table.StartsWith("xref", StringComparison.Ordinal)) return pdf;
		var trailerAt = table.IndexOf("trailer", StringComparison.Ordinal);
		var dictStart = trailerAt < 0 ? -1 : table.IndexOf("<<", trailerAt, StringComparison.Ordinal);
		var dictEnd = table.LastIndexOf(">>", StringComparison.Ordinal);
		if (dictStart < 0 || dictEnd < dictStart) return pdf;
		var trailer = table.Substring(dictStart, dictEnd + 2 - dictStart);

		var offsets = ReadXref(table.Substring(0, trailerAt));
		var infoMatch = TrailerInfo.Match(trailer);
		var rootMatch = TrailerRoot.Match(trailer);
		if (offsets == null || !infoMatch.Success || !rootMatch.Success) return pdf;
		var infoObj = int.Parse(infoMatch.Groups[1].Value, CultureInfo.InvariantCulture);
		var rootObj = int.Parse(rootMatch.Groups[1].Value, CultureInfo.InvariantCulture);
		if (infoObj >= offsets.Length || rootObj >= offsets.Length || offsets[infoObj] == 0 || offsets[rootObj] == 0)
			return pdf;

		// Each object runs from its offset to the next object's, the last one to the table.
		var order = new List<int>();
		for (var n = 1; n < offsets.Length; n++)
			if (offsets[n] > 0) order.Add(n);
		order.Sort((a, b) => offsets[a].CompareTo(offsets[b]));
		var ends = new int[offsets.Length];
		for (var i = 0; i < order.Count; i++)
			ends[order[i]] = i + 1 < order.Count ? offsets[order[i + 1]] : xrefAt;

		var catalog = Latin1.GetString(pdf, offsets[rootObj], ends[rootObj] - offsets[rootObj]);
		var metadataMatch = CatalogMetadata.Match(catalog);
		var metadataObj = metadataMatch.Success ? int.Parse(metadataMatch.Groups[1].Value, CultureInfo.InvariantCulture) : -1;

		var output = new MemoryStream(pdf.Length + (xmp?.Length ?? 0) + info.Length);
		var moved = new long[offsets.Length];
		output.Write(pdf, 0, offsets[order[0]]);

		foreach (var n in order)
		{
			moved[n] = output.Length;
			if (n == infoObj)
			{
				Write(output, $"{n} 0 obj\n{info}\nendobj\n");
			}
			else if (n == metadataObj && xmp != null)
			{
				Write(output, $"{n} 0 obj\n<</Type/Metadata/Subtype/XML/Length {xmp.Length}>>\nstream\n");
				output.Write(xmp, 0, xmp.Length);
				Write(output, "\nendstream\nendobj\n");
			}
			else if (n == metadataObj)
			{
				Write(output, $"{n} 0 obj\nnull\nendobj\n");
			}
			else if (n == rootObj && metadataObj >= 0 && xmp == null)
			{
				Write(output, catalog.Remove(metadataMatch.Index, metadataMatch.Length));
			}
			else
			{
				output.Write(pdf, offsets[n], ends[n] - offsets[n]);
			}
		}

		var tableAt = output.Length;
		var sb = new StringBuilder(32 + 20 * offsets.Length + trailer.Length);
		sb.Append("xref\n0 ").Append(offsets.Length).Append('\n');
		sb.Append("0000000000 65535 f \n");
		for (var n = 1; n < offsets.Length; n++)
		{
			sb.Append(offsets[n] > 0
				? moved[n].ToString("D10", CultureInfo.InvariantCulture) + " 00000 n \n"
				: "0000000000 00000 f \n");
		}
		// The trailer dictionary only: PDFsharp follows it with a comment naming the .NET runtime,
		// which would make net48 and net8.0 renders differ.
		sb.Append("trailer\n").Append(trailer).Append('\n');
		sb.Append("startxref\n").Append(tableAt.ToString(CultureInfo.InvariantCulture)).Append("\n%%EOF\n");
		Write(output, sb.ToString());
		return output.ToArray();
	}

	// Entry i of the single subsection "0 N" holds object i's offset; free entries read as 0.
	private static int[] ReadXref(string table)
	{
		var lines = table.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
		if (lines.Length < 2) return null;

		var header = lines[1].Trim().Split(' ');
		if (header.Length != 2 || header[0] != "0" || !int.TryParse(header[1], out var count)) return null;
		if (lines.Length - 2 != count) return null;

		var offsets = new int[count];
		for (var i = 0; i < count; i++)
		{
			var entry = lines[2 + i].Trim().Split(' ');
			if (entry.Length != 3 || !int.TryParse(entry[0], out var offset)) return null;
			offsets[i] = entry[2] == "n" ? offset : 0;
		}
		return offsets;
	}

	private static int ParseInt(string text, int from)
	{
		var i = from;
		while (i < text.Length && char.IsWhiteSpace(text[i])) i++;
		var start = i;
		while (i < text.Length && char.IsDigit(text[i])) i++;
		return i > start && int.TryParse(text.Substring(start, i - start), out var v) ? v : -1;
	}

	private static void Write(MemoryStream output, string ascii)
	{
		var bytes = Latin1.GetBytes(ascii);
		output.Write(bytes, 0, bytes.Length);
	}
}
