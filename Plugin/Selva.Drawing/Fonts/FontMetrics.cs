using System;
using System.Collections.Concurrent;
using System.IO;
using System.Reflection;
using Selva.Drawing.Model.Style;
using FontStyle = Selva.Drawing.Model.Style.FontStyle;

namespace Selva.Drawing.Fonts;

// Result of measuring a text run. Width is the sum of glyph advances; ascent/descent/
// lineHeight are the font-level metrics scaled to the requested size. All values are in
// the same units as the input font size (mm in our pipeline).
public readonly struct MeasuredText
{
	public readonly double Width;
	public readonly double Ascent;
	public readonly double Descent;       // negative number (below baseline)
	public readonly double LineGap;
	public readonly double CapHeight;
	public readonly double XHeight;

	public MeasuredText(double width, double ascent, double descent, double lineGap,
		double capHeight, double xHeight)
	{
		Width = width;
		Ascent = ascent;
		Descent = descent;
		LineGap = lineGap;
		CapHeight = capHeight;
		XHeight = xHeight;
	}

	// Total line box height (ascent + |descent| + lineGap). Use this for line spacing in
	// multi-line layouts; a TextStyle.LineHeight multiplier multiplies this further.
	public double LineHeight => Ascent + Math.Abs(Descent) + LineGap;
}

// Public facade for font metrics. Resolves a TextStyle (or family/weight/style triple) to
// a bundled font and exposes glyph-accurate measurement. Falls back to the legacy
// 0.55 × charCount heuristic when the requested family isn't bundled — that keeps existing
// callers (e.g. user-supplied font stacks like "Arial") working without exceptions.
//
// Today we ship Inter Regular + Inter Bold. Italic is mapped to Regular until we bundle
// an italic face. New families/faces are wired in by adding entries to _bundled and
// dropping a TTF into Fonts/Resources/.
public static class FontMetrics
{
	private const string ResourcePrefix = "Selva.Drawing.Fonts.Resources.";

	// Heuristic fallback constants — kept identical to the Phase 1 TextElement bounds so
	// behavior is unchanged for unknown families.
	private const double HeuristicWidthFactor = 0.55;
	private const double HeuristicAscentFactor = 0.8;
	private const double HeuristicDescentFactor = -0.2;

	private static readonly ConcurrentDictionary<string, TrueTypeFont> Cache =
		new ConcurrentDictionary<string, TrueTypeFont>(StringComparer.Ordinal);

	private static readonly (string Family, FontWeight Weight, FontStyle Style, string Resource)[] _bundled = new[]
	{
		("Inter", FontWeight.Normal, FontStyle.Normal, ResourcePrefix + "Inter-Regular.ttf"),
		("Inter", FontWeight.Normal, FontStyle.Italic, ResourcePrefix + "Inter-Regular.ttf"),
		("Inter", FontWeight.Bold,   FontStyle.Normal, ResourcePrefix + "Inter-Bold.ttf"),
		("Inter", FontWeight.Bold,   FontStyle.Italic, ResourcePrefix + "Inter-Bold.ttf"),
	};

	public static MeasuredText Measure(string text, TextStyle style)
	{
		if (style == null) throw new ArgumentNullException(nameof(style));
		return Measure(text, style.FontFamily, style.FontSize, style.Weight, style.Style);
	}

	public static MeasuredText Measure(string text, string fontFamily, double fontSize,
		FontWeight weight = FontWeight.Normal, FontStyle style = FontStyle.Normal)
	{
		text ??= string.Empty;
		if (fontSize <= 0) return default;

		var font = ResolveFont(fontFamily, weight, style);
		if (font == null) return MeasureHeuristic(text, fontSize);

		var scale = fontSize / font.UnitsPerEm;
		var advance = font.MeasureAdvance(text) * scale;
		return new MeasuredText(
			width: advance,
			ascent: font.Ascender * scale,
			descent: font.Descender * scale,
			lineGap: font.LineGap * scale,
			capHeight: font.CapHeight * scale,
			xHeight: font.XHeight * scale);
	}

	// True when a given family/weight/style is backed by a bundled font. Useful for tests
	// and renderers that want to know whether the heuristic is in play.
	public static bool IsBundled(string fontFamily, FontWeight weight = FontWeight.Normal,
		FontStyle style = FontStyle.Normal)
		=> ResolveFont(fontFamily, weight, style) != null;

	private static TrueTypeFont ResolveFont(string fontFamily, FontWeight weight, FontStyle style)
	{
		var primary = ExtractFirstFamily(fontFamily);
		foreach (var (family, w, s, resource) in _bundled)
		{
			if (string.Equals(family, primary, StringComparison.OrdinalIgnoreCase) && w == weight && s == style)
				return Cache.GetOrAdd(resource, LoadFromResource);
		}
		// Same family, any face — fall back to the regular face if weight/style is missing.
		foreach (var (family, w, s, resource) in _bundled)
		{
			if (string.Equals(family, primary, StringComparison.OrdinalIgnoreCase)
				&& w == FontWeight.Normal && s == FontStyle.Normal)
				return Cache.GetOrAdd(resource, LoadFromResource);
		}
		return null;
	}

	// "Inter, Helvetica, sans-serif" → "Inter". TextStyle.FontFamily allows CSS-style
	// stacks for SVG fallback; metrics measurement uses the first family.
	private static string ExtractFirstFamily(string fontFamily)
	{
		if (string.IsNullOrEmpty(fontFamily)) return string.Empty;
		var comma = fontFamily.IndexOf(',');
		var first = comma < 0 ? fontFamily : fontFamily.Substring(0, comma);
		return first.Trim().Trim('"', '\'');
	}

	private static TrueTypeFont LoadFromResource(string resourceName)
	{
		var assembly = typeof(FontMetrics).Assembly;
		using var stream = assembly.GetManifestResourceStream(resourceName);
		if (stream == null) throw new FileNotFoundException($"Embedded font resource not found: {resourceName}");

		using var ms = new MemoryStream();
		stream.CopyTo(ms);
		return TrueTypeFont.Parse(ms.ToArray());
	}

	private static MeasuredText MeasureHeuristic(string text, double fontSize)
	{
		var width = (text?.Length ?? 0) * fontSize * HeuristicWidthFactor;
		return new MeasuredText(
			width: width,
			ascent: fontSize * HeuristicAscentFactor,
			descent: fontSize * HeuristicDescentFactor,
			lineGap: fontSize * 0.2,
			capHeight: fontSize * 0.7,
			xHeight: fontSize * 0.5);
	}
}
