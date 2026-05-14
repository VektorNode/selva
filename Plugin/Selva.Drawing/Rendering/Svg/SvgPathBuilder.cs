using System.Globalization;
using System.Text;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Rendering.Svg;

// Builds an SVG `d=` attribute string from a typed Path. Mirrors the formatting rules
// the legacy SvgWriter used (invariant culture, "0.######" precision) so output is
// byte-identical for the same input.
public static class SvgPathBuilder
{
	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

	public static string Build(Path path)
	{
		if (path == null || path.IsEmpty) return string.Empty;
		var sb = new StringBuilder();
		AppendTo(sb, path);
		return sb.ToString();
	}

	public static void AppendTo(StringBuilder sb, Path path)
	{
		if (path == null || path.IsEmpty) return;

		var first = true;
		foreach (var seg in path)
		{
			if (!first) sb.Append(' ');
			first = false;

			switch (seg)
			{
				case PathSegment.MoveTo m:
					sb.Append('M').Append(' ').Append(F(m.To.X)).Append(' ').Append(F(m.To.Y));
					break;
				case PathSegment.LineTo l:
					sb.Append('L').Append(' ').Append(F(l.To.X)).Append(' ').Append(F(l.To.Y));
					break;
				case PathSegment.CubicTo c:
					sb.Append('C').Append(' ')
						.Append(F(c.Control1.X)).Append(' ').Append(F(c.Control1.Y)).Append(' ')
						.Append(F(c.Control2.X)).Append(' ').Append(F(c.Control2.Y)).Append(' ')
						.Append(F(c.To.X)).Append(' ').Append(F(c.To.Y));
					break;
				case PathSegment.ArcTo a:
					sb.Append('A').Append(' ')
						.Append(F(a.RadiusX)).Append(' ').Append(F(a.RadiusY)).Append(' ')
						.Append(F(a.XAxisRotationDegrees)).Append(' ')
						.Append(a.LargeArc ? '1' : '0').Append(' ')
						.Append(a.SweepClockwise ? '1' : '0').Append(' ')
						.Append(F(a.To.X)).Append(' ').Append(F(a.To.Y));
					break;
				case PathSegment.Close _:
					sb.Append('Z');
					break;
			}
		}
	}

	private static string F(double v) => v.ToString("0.######", Inv);
}
