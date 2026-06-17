using System;

namespace Selva.Drawing.Model;

// Page dimensions in millimetres. ISO 216 A-series + common US imperial sizes are
// available as named constants; arbitrary sizes are constructed via Custom(w, h).
// Width/Height are always portrait by default; call Landscape() to flip orientation.
public readonly struct PaperSize : IEquatable<PaperSize>
{
	public double WidthMm { get; }
	public double HeightMm { get; }
	public string Name { get; }

	public PaperSize(double widthMm, double heightMm, string name = null)
	{
		if (widthMm <= 0 || heightMm <= 0) throw new ArgumentException("Paper dimensions must be positive.");
		WidthMm = widthMm;
		HeightMm = heightMm;
		Name = name;
	}

	public static PaperSize Custom(double widthMm, double heightMm) => new PaperSize(widthMm, heightMm);

	public PaperSize Landscape() =>
		WidthMm >= HeightMm ? this : new PaperSize(HeightMm, WidthMm, Name);

	public PaperSize Portrait() =>
		HeightMm >= WidthMm ? this : new PaperSize(HeightMm, WidthMm, Name);

	public static readonly PaperSize A0 = new PaperSize(841, 1189, "A0");
	public static readonly PaperSize A1 = new PaperSize(594, 841, "A1");
	public static readonly PaperSize A2 = new PaperSize(420, 594, "A2");
	public static readonly PaperSize A3 = new PaperSize(297, 420, "A3");
	public static readonly PaperSize A4 = new PaperSize(210, 297, "A4");
	public static readonly PaperSize A5 = new PaperSize(148, 210, "A5");
	public static readonly PaperSize Letter = new PaperSize(215.9, 279.4, "Letter");
	public static readonly PaperSize Legal = new PaperSize(215.9, 355.6, "Legal");
	public static readonly PaperSize Tabloid = new PaperSize(279.4, 431.8, "Tabloid");

	// ANSI/ASME Y14.1 engineering series, defined in inches → mm (1 in = 25.4 mm). ANSI A == Letter
	// and ANSI B == Tabloid, but the named constants make the imperial series discoverable.
	public static readonly PaperSize AnsiA = Inches(8.5, 11, "ANSI A");
	public static readonly PaperSize AnsiB = Inches(11, 17, "ANSI B");
	public static readonly PaperSize AnsiC = Inches(17, 22, "ANSI C");
	public static readonly PaperSize AnsiD = Inches(22, 34, "ANSI D");
	public static readonly PaperSize AnsiE = Inches(34, 44, "ANSI E");

	// ARCH architectural series, in inches → mm.
	public static readonly PaperSize ArchA = Inches(9, 12, "ARCH A");
	public static readonly PaperSize ArchB = Inches(12, 18, "ARCH B");
	public static readonly PaperSize ArchC = Inches(18, 24, "ARCH C");
	public static readonly PaperSize ArchD = Inches(24, 36, "ARCH D");
	public static readonly PaperSize ArchE = Inches(36, 48, "ARCH E");

	private static PaperSize Inches(double widthIn, double heightIn, string name) =>
		new PaperSize(widthIn * 25.4, heightIn * 25.4, name);

	public bool Equals(PaperSize other) =>
		WidthMm == other.WidthMm && HeightMm == other.HeightMm && Name == other.Name;

	public override bool Equals(object obj) => obj is PaperSize p && Equals(p);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = WidthMm.GetHashCode();
			h = (h * 397) ^ HeightMm.GetHashCode();
			h = (h * 397) ^ (Name?.GetHashCode() ?? 0);
			return h;
		}
	}

	public static bool operator ==(PaperSize a, PaperSize b) => a.Equals(b);
	public static bool operator !=(PaperSize a, PaperSize b) => !a.Equals(b);
}

// Page margins in millimetres. Defaults match the existing 10mm padding used by SvgDocument.
public readonly struct Margins : IEquatable<Margins>
{
	public double Top { get; }
	public double Right { get; }
	public double Bottom { get; }
	public double Left { get; }

	public Margins(double top, double right, double bottom, double left)
	{
		Top = top; Right = right; Bottom = bottom; Left = left;
	}

	public static Margins Uniform(double mm) => new Margins(mm, mm, mm, mm);
	public static Margins Symmetric(double vertical, double horizontal) => new Margins(vertical, horizontal, vertical, horizontal);
	public static readonly Margins Zero = new Margins(0, 0, 0, 0);

	public bool Equals(Margins other) => Top == other.Top && Right == other.Right && Bottom == other.Bottom && Left == other.Left;
	public override bool Equals(object obj) => obj is Margins m && Equals(m);
	public override int GetHashCode()
	{
		unchecked
		{
			var h = Top.GetHashCode();
			h = (h * 397) ^ Right.GetHashCode();
			h = (h * 397) ^ Bottom.GetHashCode();
			h = (h * 397) ^ Left.GetHashCode();
			return h;
		}
	}
	public static bool operator ==(Margins a, Margins b) => a.Equals(b);
	public static bool operator !=(Margins a, Margins b) => !a.Equals(b);
}
