using System;

namespace Selva.Drawing.Model.Style;

public enum FontWeight { Normal, Bold }
public enum FontStyle { Normal, Italic }
public enum TextDecoration { None, Underline, Strikethrough }
public enum TextAnchor { Left, Center, Right }
public enum VerticalAnchor { Top, Middle, Baseline, Bottom }

// Text rendering style. FontFamily is a single family name (or a comma-separated stack
// for SVG fallback); the PDF renderer will pick the first family it can resolve to a
// bundled or installed font. Size is in document units (mm).
public sealed class TextStyle : IEquatable<TextStyle>
{
	public string FontFamily { get; init; } = "Inter";
	public double FontSize { get; init; } = 3.0;
	public FontWeight Weight { get; init; } = FontWeight.Normal;
	public FontStyle Style { get; init; } = FontStyle.Normal;
	public TextDecoration Decoration { get; init; } = TextDecoration.None;
	public Color Color { get; init; } = Color.Black;
	public TextAnchor HorizontalAnchor { get; init; } = TextAnchor.Left;
	public VerticalAnchor VerticalAnchor { get; init; } = VerticalAnchor.Baseline;
	public double LineHeight { get; init; } = 1.2;
	public double LetterSpacing { get; init; } = 0.0;

	public bool Equals(TextStyle other)
	{
		if (other is null) return false;
		if (ReferenceEquals(this, other)) return true;
		return FontFamily == other.FontFamily
			&& FontSize == other.FontSize
			&& Weight == other.Weight
			&& Style == other.Style
			&& Decoration == other.Decoration
			&& Color == other.Color
			&& HorizontalAnchor == other.HorizontalAnchor
			&& VerticalAnchor == other.VerticalAnchor
			&& LineHeight == other.LineHeight
			&& LetterSpacing == other.LetterSpacing;
	}

	public override bool Equals(object obj) => Equals(obj as TextStyle);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = FontFamily?.GetHashCode() ?? 0;
			h = (h * 397) ^ FontSize.GetHashCode();
			h = (h * 397) ^ (int)Weight;
			h = (h * 397) ^ (int)Style;
			h = (h * 397) ^ (int)Decoration;
			h = (h * 397) ^ Color.GetHashCode();
			h = (h * 397) ^ (int)HorizontalAnchor;
			h = (h * 397) ^ (int)VerticalAnchor;
			h = (h * 397) ^ LineHeight.GetHashCode();
			h = (h * 397) ^ LetterSpacing.GetHashCode();
			return h;
		}
	}
}
