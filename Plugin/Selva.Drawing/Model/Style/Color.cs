using System;
using System.Globalization;

namespace Selva.Drawing.Model.Style;

public enum ColorSpace { Rgb, Cmyk, Named }

// Immutable color value. RGB is in [0..1] linear-sRGB-ish floats (PdfSharpCore + SVG both
// accept that range). CMYK lives alongside so print PDFs can emit native CMYK ink values
// without going through an RGB round-trip. Named exists so palette literals like
// "currentColor" or future spot-color slots survive untouched into the renderer.
public readonly struct Color : IEquatable<Color>
{
	public ColorSpace Space { get; }

	// RGBA channels (0..1). Valid only when Space == Rgb.
	public float R { get; }
	public float G { get; }
	public float B { get; }
	public float A { get; }

	// CMYK channels (0..1). Valid only when Space == Cmyk. Alpha applies to all.
	public float C { get; }
	public float M { get; }
	public float Y { get; }
	public float K { get; }

	public string Name { get; }

	private Color(ColorSpace space, float r, float g, float b, float a, float c, float m, float y, float k, string name)
	{
		Space = space;
		R = r; G = g; B = b; A = a;
		C = c; M = m; Y = y; K = k;
		Name = name;
	}

	public static Color Rgb(float r, float g, float b, float a = 1f) =>
		new Color(ColorSpace.Rgb, Clamp01(r), Clamp01(g), Clamp01(b), Clamp01(a), 0, 0, 0, 0, null);

	public static Color Rgb(byte r, byte g, byte b, byte a = 255) =>
		new Color(ColorSpace.Rgb, r / 255f, g / 255f, b / 255f, a / 255f, 0, 0, 0, 0, null);

	public static Color Cmyk(float c, float m, float y, float k, float a = 1f) =>
		new Color(ColorSpace.Cmyk, 0, 0, 0, Clamp01(a), Clamp01(c), Clamp01(m), Clamp01(y), Clamp01(k), null);

	public static Color Named(string name)
	{
		if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("name must be non-empty", nameof(name));
		return new Color(ColorSpace.Named, 0, 0, 0, 1, 0, 0, 0, 0, name);
	}

	public static Color FromHex(string hex)
	{
		if (hex == null) throw new ArgumentNullException(nameof(hex));
		var h = hex.Trim().TrimStart('#');
		if (h.Length != 6 && h.Length != 8)
			throw new ArgumentException("hex must be 6 or 8 characters (#RRGGBB or #RRGGBBAA)", nameof(hex));

		var r = byte.Parse(h.Substring(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
		var g = byte.Parse(h.Substring(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
		var b = byte.Parse(h.Substring(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
		var a = h.Length == 8
			? byte.Parse(h.Substring(6, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture)
			: (byte)255;
		return Rgb(r, g, b, a);
	}

	public static readonly Color Black = Rgb(0f, 0f, 0f);
	public static readonly Color White = Rgb(1f, 1f, 1f);
	public static readonly Color Transparent = Rgb(0f, 0f, 0f, 0f);

	private static float Clamp01(float v) => v < 0f ? 0f : v > 1f ? 1f : v;

	public bool Equals(Color other) =>
		Space == other.Space &&
		R == other.R && G == other.G && B == other.B && A == other.A &&
		C == other.C && M == other.M && Y == other.Y && K == other.K &&
		Name == other.Name;

	public override bool Equals(object obj) => obj is Color c && Equals(c);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = (int)Space;
			h = (h * 397) ^ R.GetHashCode();
			h = (h * 397) ^ G.GetHashCode();
			h = (h * 397) ^ B.GetHashCode();
			h = (h * 397) ^ A.GetHashCode();
			h = (h * 397) ^ C.GetHashCode();
			h = (h * 397) ^ M.GetHashCode();
			h = (h * 397) ^ Y.GetHashCode();
			h = (h * 397) ^ K.GetHashCode();
			h = (h * 397) ^ (Name?.GetHashCode() ?? 0);
			return h;
		}
	}

	public static bool operator ==(Color a, Color b) => a.Equals(b);
	public static bool operator !=(Color a, Color b) => !a.Equals(b);
}
