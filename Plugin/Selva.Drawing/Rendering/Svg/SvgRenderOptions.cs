namespace Selva.Drawing.Rendering.Svg;

// Configures SvgRenderer. Defaults reproduce legacy SvgDocument.Build output byte-for-byte.
public sealed class SvgRenderOptions
{
	public const string DefaultFontFamily =
		"Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif";

	// Auto-fit the viewBox to the union of element bounds plus Padding. When false,
	// the renderer uses the page's paper size for width/height instead.
	public bool AutoFitToContent { get; init; } = true;

	// Ignored when AutoFitToContent is false.
	public double Padding { get; init; } = 10.0;

	// CSS color (e.g. "white", "#fff"). When set, emits a full-canvas <rect> behind
	// the content group.
	public string BackgroundColor { get; init; }

	public string FontFamily { get; init; } = DefaultFontFamily;

	// Off by default: keeps parity with legacy output, which never embedded fonts.
	public bool EmbedFonts { get; init; }

	// Title for the SVG <title> element. When null, falls back to Page.Title, then
	// Document.Metadata.Title. Empty string suppresses <title> entirely.
	public string Title { get; init; }
}
