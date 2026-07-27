namespace Selva.Drawing.Model.Style;

// The drawing system's lineweights, in paper-space millimetres.
//
// These exist so a width is never written as a bare literal at a use site. Every default and
// fallback in the model and both renderers resolves to a named value here, which is what keeps
// the PDF and SVG outputs agreeing: they used to drift because the same conceptual weight was
// spelled as an independent number in each renderer (an unstyled path was 0.25 mm in PDF and
// 1.0 mm in SVG, a 4x difference, because only one of them wrote the literal down).
//
// The ladder is ISO 128 / ISO 3098: each step is ~sqrt(2) times the previous, so weights stay
// visually distinct at any print scale. Pick from the named steps rather than inventing values
// in between — the whole point is that a drawing uses a small, legible set of weights.
public static class LineWeight
{
	// Thinnest ISO step — the usual CAD "hairline". Visible on a 300 dpi office printer
	// (~1.5 device pixels); anything thinner starts dropping below the dot pitch and renders
	// inconsistently across devices. To remove a line entirely use Width = 0, which is not a
	// weight at all but a suppression flag (see Stroke).
	public const double Thin = 0.13;

	// Hatching, section fill, and other secondary linework.
	public const double ExtraFine = 0.18;

	// The default body weight: general linework, borders, dimension lines.
	public const double Fine = 0.25;

	// Visible edges and outlines that need to read above the body weight.
	public const double Medium = 0.35;

	// Section cuts and primary outlines.
	public const double Thick = 0.5;

	// Sheet borders and title-block frames.
	public const double ExtraThick = 0.7;

	// Heaviest ISO step; emphasis only.
	public const double Heavy = 1.0;
}
