using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

namespace Selva.Drawing.Rendering.Pdf;

// PDFsharp writes a random font-subset tag (from a new Guid) and a random trailer /ID, so
// the same document saved twice differs. Both are rewritten here in place, same length, so the
// cross-reference offsets stay valid: the tag from a hash of the embedded subset's font file
// (different subsets must get different tags, or viewers that cache fonts by name mix glyphs
// across documents), the /ID from a hash of the file with the /ID blanked.
//
// Only name and hex-string tokens of the object syntax are touched. Literal strings (titles,
// keywords) and stream bodies are skipped, so user text that happens to look like "/ABCDEF+x"
// survives.
internal static class PdfDeterminism
{
	private const int TagLength = 6;

	public static void Apply(byte[] pdf)
	{
		var scan = Scan(pdf);
		RetagSubsets(pdf, scan);
		RestampId(pdf, scan);
	}

	// "/BaseFont /ABCDEF+Inter,Bold" and "/FontName /ABCDEF+Inter,Bold" share the tag, so every
	// occurrence of one original tag maps to the same new one.
	private static void RetagSubsets(byte[] pdf, ScanResult scan)
	{
		var retag = new Dictionary<string, byte[]>(StringComparer.Ordinal);

		foreach (var pair in scan.FontFileOf)
		{
			if (!scan.TagOf.TryGetValue(pair.Key, out var tag) || retag.ContainsKey(tag)) continue;
			if (!scan.Streams.TryGetValue(pair.Value, out var body)) continue;
			retag[tag] = Sha256(pdf, body.Start, body.Length);
		}

		// No font file found: fall back to the font's name, deterministic if not subset-unique.
		foreach (var name in scan.SubsetNames)
			if (!retag.ContainsKey(name.Tag))
				retag[name.Tag] = Sha256(pdf, name.NameStart, name.NameEnd - name.NameStart);

		foreach (var name in scan.SubsetNames)
		{
			var hash = retag[name.Tag];
			for (var k = 0; k < TagLength; k++) pdf[name.TagStart + k] = (byte)('A' + hash[k] % 26);
		}
	}

	// "/ID [<32 hex><32 hex>]"
	private static void RestampId(byte[] pdf, ScanResult scan)
	{
		if (scan.IdFirst < 0) return;
		var first = scan.IdFirst + 1;
		var second = scan.IdSecond + 1;

		for (var k = 0; k < 32; k++) pdf[first + k] = pdf[second + k] = (byte)'0';
		var hash = Sha256(pdf, 0, pdf.Length);
		for (var k = 0; k < 16; k++)
		{
			var hex = hash[k].ToString("X2");
			pdf[first + 2 * k] = pdf[second + 2 * k] = (byte)hex[0];
			pdf[first + 2 * k + 1] = pdf[second + 2 * k + 1] = (byte)hex[1];
		}
	}

	// ============================================================================
	// Tokenizer
	// ============================================================================

	private enum Kind { Int, Name, Hex, Delimiter, Keyword }

	private readonly struct Token
	{
		public readonly Kind Kind;
		public readonly int Start;
		public readonly int End;
		public readonly int Int;

		public Token(Kind kind, int start, int end, int value = 0)
		{
			Kind = kind;
			Start = start;
			End = end;
			Int = value;
		}
	}

	private readonly struct SubsetName
	{
		public readonly string Tag;
		public readonly int TagStart;
		public readonly int NameStart;
		public readonly int NameEnd;

		public SubsetName(string tag, int tagStart, int nameStart, int nameEnd)
		{
			Tag = tag;
			TagStart = tagStart;
			NameStart = nameStart;
			NameEnd = nameEnd;
		}
	}

	private sealed class ScanResult
	{
		public readonly List<SubsetName> SubsetNames = new();
		// Object number -> the subset tag named in it (a FontDescriptor's /FontName).
		public readonly Dictionary<int, string> TagOf = new();
		// FontDescriptor object number -> its /FontFile, /FontFile2 or /FontFile3 object number.
		public readonly Dictionary<int, int> FontFileOf = new();
		public readonly Dictionary<int, (int Start, int Length)> Streams = new();
		// Offsets of the '<' opening each /ID hex string, or -1.
		public int IdFirst = -1;
		public int IdSecond = -1;
	}

	private static ScanResult Scan(byte[] pdf)
	{
		var result = new ScanResult();
		var recent = new List<Token>(4);
		var obj = -1;
		int? length = null;
		var i = 0;

		while (i < pdf.Length)
		{
			var b = pdf[i];
			if (IsWhitespace(b)) { i++; continue; }

			if (b == (byte)'%')
			{
				while (i < pdf.Length && pdf[i] != (byte)'\r' && pdf[i] != (byte)'\n') i++;
				continue;
			}

			Token token;
			if (b == (byte)'(')
			{
				i = SkipLiteralString(pdf, i);
				recent.Clear();
				continue;
			}
			if (b == (byte)'<' && i + 1 < pdf.Length && pdf[i + 1] == (byte)'<')
			{
				token = new Token(Kind.Delimiter, i, i + 2);
			}
			else if (b == (byte)'>' && i + 1 < pdf.Length && pdf[i + 1] == (byte)'>')
			{
				token = new Token(Kind.Delimiter, i, i + 2);
			}
			else if (b == (byte)'<')
			{
				var end = Array.IndexOf(pdf, (byte)'>', i + 1);
				if (end < 0) break;
				token = new Token(Kind.Hex, i, end + 1);
			}
			else if (b is (byte)'[' or (byte)']' or (byte)'{' or (byte)'}' or (byte)'>' or (byte)')')
			{
				token = new Token(Kind.Delimiter, i, i + 1);
			}
			else if (b == (byte)'/')
			{
				var end = i + 1;
				while (end < pdf.Length && !IsWhitespace(pdf[end]) && !IsDelimiter(pdf[end])) end++;
				token = new Token(Kind.Name, i, end);
			}
			else
			{
				var end = i;
				while (end < pdf.Length && !IsWhitespace(pdf[end]) && !IsDelimiter(pdf[end])) end++;
				token = TryParseInt(pdf, i, end, out var value)
					? new Token(Kind.Int, i, end, value)
					: new Token(Kind.Keyword, i, end);
			}

			i = token.End;

			switch (token.Kind)
			{
				case Kind.Name:
					if (IsSubsetName(pdf, token))
					{
						var tag = Encoding.ASCII.GetString(pdf, token.Start + 1, TagLength);
						result.SubsetNames.Add(new SubsetName(tag, token.Start + 1, token.Start + TagLength + 2, token.End));
						if (obj >= 0) result.TagOf[obj] = tag;
					}
					break;

				case Kind.Int:
					if (Last(recent, 0) is { Kind: Kind.Name } prev && NameIs(pdf, prev, "/Length")) length = token.Int;
					break;

				case Kind.Hex:
					if (Last(recent, 0) is { Kind: Kind.Delimiter } open && pdf[open.Start] == (byte)'['
						&& Last(recent, 1) is { Kind: Kind.Name } id && NameIs(pdf, id, "/ID"))
					{
						result.IdFirst = token.End - token.Start == 34 ? token.Start : -1;
						result.IdSecond = -1;
					}
					else if (result.IdFirst >= 0 && result.IdSecond < 0 && Last(recent, 0) is { Kind: Kind.Hex } firstId
						&& firstId.Start == result.IdFirst)
					{
						if (token.End - token.Start == 34) result.IdSecond = token.Start;
						else result.IdFirst = -1;
					}
					break;

				case Kind.Keyword:
					if (KeywordIs(pdf, token, "obj") && Last(recent, 0) is { Kind: Kind.Int } && Last(recent, 1) is { Kind: Kind.Int } number)
					{
						obj = number.Int;
						length = null;
					}
					else if (KeywordIs(pdf, token, "endobj"))
					{
						obj = -1;
					}
					else if (KeywordIs(pdf, token, "R") && Last(recent, 0) is { Kind: Kind.Int } && Last(recent, 1) is { Kind: Kind.Int } target
						&& Last(recent, 2) is { Kind: Kind.Name } key)
					{
						if (NameIs(pdf, key, "/Length")) length = null;
						else if (obj >= 0 && (NameIs(pdf, key, "/FontFile") || NameIs(pdf, key, "/FontFile2") || NameIs(pdf, key, "/FontFile3")))
							result.FontFileOf[obj] = target.Int;
					}
					else if (KeywordIs(pdf, token, "stream"))
					{
						var start = i;
						if (start < pdf.Length && pdf[start] == (byte)'\r') start++;
						if (start < pdf.Length && pdf[start] == (byte)'\n') start++;
						var end = StreamEnd(pdf, start, length);
						if (end < 0) return result;
						if (obj >= 0) result.Streams[obj] = (start, end - start);
						i = end;
						recent.Clear();
						continue;
					}
					break;
			}

			if (recent.Count == 3) recent.RemoveAt(0);
			recent.Add(token);
		}

		if (result.IdSecond < 0) result.IdFirst = -1;
		return result;
	}

	// Trusts /Length when "endstream" follows it; an indirect or wrong /Length falls back to the
	// first "endstream", the best guess when the length is unknown.
	private static int StreamEnd(byte[] pdf, int start, int? length)
	{
		var keyword = Encoding.ASCII.GetBytes("endstream");
		if (length is int n && n >= 0 && start + n <= pdf.Length)
		{
			var after = start + n;
			while (after < pdf.Length && IsWhitespace(pdf[after])) after++;
			if (Matches(pdf, keyword, after)) return start + n;
		}
		return IndexOf(pdf, keyword, start);
	}

	private static int SkipLiteralString(byte[] pdf, int at)
	{
		var depth = 0;
		for (var i = at; i < pdf.Length; i++)
		{
			switch (pdf[i])
			{
				case (byte)'\\': i++; break;
				case (byte)'(': depth++; break;
				case (byte)')':
					if (--depth == 0) return i + 1;
					break;
			}
		}
		return pdf.Length;
	}

	private static bool IsSubsetName(byte[] pdf, Token name)
	{
		if (name.End - name.Start < TagLength + 3 || pdf[name.Start + TagLength + 1] != (byte)'+') return false;
		for (var k = 1; k <= TagLength; k++)
			if (pdf[name.Start + k] < (byte)'A' || pdf[name.Start + k] > (byte)'Z') return false;
		return true;
	}

	private static Token? Last(List<Token> recent, int back) =>
		recent.Count > back ? recent[recent.Count - 1 - back] : null;

	private static bool NameIs(byte[] pdf, Token token, string name) => KeywordIs(pdf, token, name);

	private static bool KeywordIs(byte[] pdf, Token token, string word)
	{
		if (token.End - token.Start != word.Length) return false;
		for (var k = 0; k < word.Length; k++)
			if (pdf[token.Start + k] != (byte)word[k]) return false;
		return true;
	}

	private static bool TryParseInt(byte[] pdf, int start, int end, out int value)
	{
		value = 0;
		if (end == start || end - start > 9) return false;
		for (var k = start; k < end; k++)
		{
			if (pdf[k] < (byte)'0' || pdf[k] > (byte)'9') return false;
			value = value * 10 + (pdf[k] - '0');
		}
		return true;
	}

	private static bool IsWhitespace(byte b) =>
		b is (byte)' ' or (byte)'\r' or (byte)'\n' or (byte)'\t' or (byte)'\f' or 0;

	private static bool IsDelimiter(byte b) =>
		b is (byte)'/' or (byte)'[' or (byte)']' or (byte)'<' or (byte)'>' or (byte)'(' or (byte)')'
			or (byte)'{' or (byte)'}' or (byte)'%';

	private static byte[] Sha256(byte[] b, int offset, int count)
	{
		using var sha = SHA256.Create();
		return sha.ComputeHash(b, offset, count);
	}

	private static int IndexOf(byte[] b, byte[] pattern, int from)
	{
		for (var i = Math.Max(0, from); i <= b.Length - pattern.Length; i++)
			if (Matches(b, pattern, i)) return i;
		return -1;
	}

	private static bool Matches(byte[] b, byte[] pattern, int at)
	{
		if (at < 0 || at + pattern.Length > b.Length) return false;
		for (var k = 0; k < pattern.Length; k++)
			if (b[at + k] != pattern[k]) return false;
		return true;
	}
}
