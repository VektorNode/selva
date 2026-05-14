using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Selva.Drawing.Fonts;

// Minimal TrueType/OpenType parser. Reads only the tables we need for layout-aware text
// (cmap format 4 & 12 → char→glyph index, hmtx → glyph advance widths, head → unitsPerEm,
// hhea → ascender/descender/lineGap, maxp → numGlyphs). No glyph rendering, no kerning,
// no shaping — Phase 4's job is unblocking dimension text gaps and TextElement bounds,
// not WYSIWYG layout.
internal sealed class TrueTypeFont
{
	public int UnitsPerEm { get; }
	public int Ascender { get; }
	public int Descender { get; }
	public int LineGap { get; }
	public int CapHeight { get; }
	public int XHeight { get; }

	private readonly Dictionary<int, int> _cmap;
	private readonly int[] _glyphAdvances;
	private readonly int _missingGlyphAdvance;

	private TrueTypeFont(int unitsPerEm, int ascender, int descender, int lineGap,
		int capHeight, int xHeight,
		Dictionary<int, int> cmap, int[] glyphAdvances, int missingGlyphAdvance)
	{
		UnitsPerEm = unitsPerEm;
		Ascender = ascender;
		Descender = descender;
		LineGap = lineGap;
		CapHeight = capHeight;
		XHeight = xHeight;
		_cmap = cmap;
		_glyphAdvances = glyphAdvances;
		_missingGlyphAdvance = missingGlyphAdvance;
	}

	// Returns the unscaled advance (in font units) for the given codepoint. Falls back to
	// the .notdef glyph's advance when the codepoint isn't in the cmap.
	public int GetAdvance(int codepoint)
	{
		if (_cmap.TryGetValue(codepoint, out var gid) && gid >= 0 && gid < _glyphAdvances.Length)
			return _glyphAdvances[gid];
		return _missingGlyphAdvance;
	}

	// Sums glyph advances across the string (treating it as a sequence of UTF-32
	// codepoints — handles surrogate pairs). Returns advance in font units; caller scales
	// by fontSize / UnitsPerEm.
	public int MeasureAdvance(string text)
	{
		if (string.IsNullOrEmpty(text)) return 0;
		var total = 0;
		for (var i = 0; i < text.Length; i++)
		{
			int cp;
			var c = text[i];
			if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
			{
				cp = char.ConvertToUtf32(c, text[i + 1]);
				i++;
			}
			else
			{
				cp = c;
			}
			total += GetAdvance(cp);
		}
		return total;
	}

	public static TrueTypeFont Parse(byte[] data)
	{
		if (data == null) throw new ArgumentNullException(nameof(data));
		if (data.Length < 12) throw new InvalidDataException("Font data is too short.");

		var r = new BigEndianReader(data);

		// Offset Table
		var sfntVersion = r.ReadUInt32();
		if (sfntVersion != 0x00010000u && sfntVersion != 0x4F54544Fu /* OTTO */ && sfntVersion != 0x74727565u /* true */)
			throw new InvalidDataException($"Unsupported sfnt version 0x{sfntVersion:X8}.");
		var numTables = r.ReadUInt16();
		r.Skip(6); // searchRange, entrySelector, rangeShift

		var tables = new Dictionary<string, (int Offset, int Length)>(numTables);
		for (var i = 0; i < numTables; i++)
		{
			var tag = Encoding.ASCII.GetString(r.ReadBytes(4));
			r.ReadUInt32(); // checksum
			var offset = (int)r.ReadUInt32();
			var length = (int)r.ReadUInt32();
			tables[tag] = (offset, length);
		}

		// head
		if (!tables.TryGetValue("head", out var head)) throw new InvalidDataException("Missing 'head' table.");
		r.Position = head.Offset + 18;
		var unitsPerEm = r.ReadUInt16();

		// maxp
		if (!tables.TryGetValue("maxp", out var maxp)) throw new InvalidDataException("Missing 'maxp' table.");
		r.Position = maxp.Offset + 4;
		var numGlyphs = r.ReadUInt16();

		// hhea
		if (!tables.TryGetValue("hhea", out var hhea)) throw new InvalidDataException("Missing 'hhea' table.");
		r.Position = hhea.Offset + 4;
		var ascender = r.ReadInt16();
		var descender = r.ReadInt16();
		var lineGap = r.ReadInt16();
		r.Position = hhea.Offset + 34;
		var numberOfHMetrics = r.ReadUInt16();

		// hmtx
		if (!tables.TryGetValue("hmtx", out var hmtx)) throw new InvalidDataException("Missing 'hmtx' table.");
		var advances = new int[numGlyphs];
		r.Position = hmtx.Offset;
		var lastAdvance = 0;
		for (var i = 0; i < numberOfHMetrics; i++)
		{
			lastAdvance = r.ReadUInt16();
			r.ReadInt16(); // lsb (left side bearing) — unused
			advances[i] = lastAdvance;
		}
		// Glyphs past numberOfHMetrics share the last entry's advance (per spec).
		for (var i = numberOfHMetrics; i < numGlyphs; i++)
			advances[i] = lastAdvance;
		var missingGlyphAdvance = advances.Length > 0 ? advances[0] : 0;

		// OS/2 — capHeight/xHeight if version ≥ 2.
		var capHeight = 0;
		var xHeight = 0;
		if (tables.TryGetValue("OS/2", out var os2) && os2.Length >= 90)
		{
			r.Position = os2.Offset;
			var os2Version = r.ReadUInt16();
			if (os2Version >= 2)
			{
				r.Position = os2.Offset + 86;
				xHeight = r.ReadInt16();
				capHeight = r.ReadInt16();
			}
		}
		// Sensible fallbacks if OS/2 v2 isn't present.
		if (capHeight <= 0) capHeight = (int)(ascender * 0.7);
		if (xHeight <= 0) xHeight = (int)(ascender * 0.5);

		// cmap
		if (!tables.TryGetValue("cmap", out var cmap)) throw new InvalidDataException("Missing 'cmap' table.");
		var cmapDict = ParseCmap(r, cmap.Offset);

		return new TrueTypeFont(unitsPerEm, ascender, descender, lineGap, capHeight, xHeight,
			cmapDict, advances, missingGlyphAdvance);
	}

	private static Dictionary<int, int> ParseCmap(BigEndianReader r, int cmapOffset)
	{
		r.Position = cmapOffset;
		r.ReadUInt16(); // version
		var numSubtables = r.ReadUInt16();

		// Pick the best subtable: prefer (3,10) Unicode full repertoire, then (0,4)/(0,3)
		// Unicode 2.0+ BMP, then any (3,1) Windows Unicode BMP. Falls through to first
		// usable.
		var bestOffset = 0;
		var bestRank = int.MaxValue;
		for (var i = 0; i < numSubtables; i++)
		{
			var platformID = r.ReadUInt16();
			var encodingID = r.ReadUInt16();
			var subOffset = (int)r.ReadUInt32();
			int rank;
			if (platformID == 3 && encodingID == 10) rank = 0; // Windows, full Unicode
			else if (platformID == 0 && encodingID >= 3) rank = 1; // Unicode 2.0+
			else if (platformID == 3 && encodingID == 1) rank = 2; // Windows BMP
			else if (platformID == 0) rank = 3; // any Unicode
			else rank = 100;
			if (rank < bestRank)
			{
				bestRank = rank;
				bestOffset = subOffset;
			}
		}

		if (bestOffset == 0) return new Dictionary<int, int>();

		r.Position = cmapOffset + bestOffset;
		var format = r.ReadUInt16();
		switch (format)
		{
			case 4: return ParseCmapFormat4(r, cmapOffset + bestOffset);
			case 12: return ParseCmapFormat12(r);
			default: return new Dictionary<int, int>();
		}
	}

	private static Dictionary<int, int> ParseCmapFormat4(BigEndianReader r, int subtableOffset)
	{
		// We've already read format (uint16). Continue with length, language.
		r.ReadUInt16(); // length
		r.ReadUInt16(); // language
		var segCountX2 = r.ReadUInt16();
		var segCount = segCountX2 / 2;
		r.Skip(6); // searchRange, entrySelector, rangeShift

		var endCodes = new int[segCount];
		for (var i = 0; i < segCount; i++) endCodes[i] = r.ReadUInt16();
		r.ReadUInt16(); // reservedPad
		var startCodes = new int[segCount];
		for (var i = 0; i < segCount; i++) startCodes[i] = r.ReadUInt16();
		var idDeltas = new int[segCount];
		for (var i = 0; i < segCount; i++) idDeltas[i] = r.ReadInt16();
		var idRangeOffsetPos = r.Position;
		var idRangeOffsets = new int[segCount];
		for (var i = 0; i < segCount; i++) idRangeOffsets[i] = r.ReadUInt16();

		var map = new Dictionary<int, int>();
		for (var i = 0; i < segCount; i++)
		{
			var start = startCodes[i];
			var end = endCodes[i];
			if (start == 0xFFFF && end == 0xFFFF) continue;
			for (var c = start; c <= end; c++)
			{
				int gid;
				if (idRangeOffsets[i] == 0)
				{
					gid = (c + idDeltas[i]) & 0xFFFF;
				}
				else
				{
					// Per spec: glyphIndex = *(idRangeOffsets[i]/2 + (c - startCode[i]) + &idRangeOffsets[i])
					var addr = idRangeOffsetPos + i * 2 + idRangeOffsets[i] + (c - start) * 2;
					var saved = r.Position;
					r.Position = addr;
					var raw = r.ReadUInt16();
					r.Position = saved;
					gid = raw == 0 ? 0 : (raw + idDeltas[i]) & 0xFFFF;
				}
				if (gid != 0) map[c] = gid;
			}
		}
		_ = subtableOffset;
		return map;
	}

	private static Dictionary<int, int> ParseCmapFormat12(BigEndianReader r)
	{
		r.ReadUInt16(); // reserved
		r.ReadUInt32(); // length
		r.ReadUInt32(); // language
		var numGroups = (int)r.ReadUInt32();
		var map = new Dictionary<int, int>();
		for (var i = 0; i < numGroups; i++)
		{
			var startChar = (int)r.ReadUInt32();
			var endChar = (int)r.ReadUInt32();
			var startGlyph = (int)r.ReadUInt32();
			for (var c = startChar; c <= endChar; c++)
				map[c] = startGlyph + (c - startChar);
		}
		return map;
	}

	private sealed class BigEndianReader
	{
		private readonly byte[] _data;
		public int Position;
		public BigEndianReader(byte[] data) { _data = data; }

		public byte ReadByte() => _data[Position++];
		public byte[] ReadBytes(int n)
		{
			var buf = new byte[n];
			Buffer.BlockCopy(_data, Position, buf, 0, n);
			Position += n;
			return buf;
		}
		public ushort ReadUInt16()
		{
			var v = (ushort)((_data[Position] << 8) | _data[Position + 1]);
			Position += 2;
			return v;
		}
		public short ReadInt16() => (short)ReadUInt16();
		public uint ReadUInt32()
		{
			var v = (uint)((_data[Position] << 24) | (_data[Position + 1] << 16)
				| (_data[Position + 2] << 8) | _data[Position + 3]);
			Position += 4;
			return v;
		}
		public void Skip(int n) { Position += n; }
	}
}
