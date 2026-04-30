namespace Selva.Drawing.Rendering.Svg;

// Configures SvgRenderer. Defaults reproduce the legacy SvgDocument.Build output for
// parity testing; embedding fonts and using the page's paper size are opt-in.
public sealed class SvgRenderOptions
{
	public const string DefaultFontFamily =
		"Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif";

	// Auto-fit the viewBox to the union of element bounds plus Padding on each side.
	// Matches legacy behavior. When false, the renderer uses the page's paper size for
	// width/height (Phase 6 territory).
	public bool AutoFitToContent { get; init; } = true;

	// Padding around the auto-fit content bounds, in document units. Ignored when
	// AutoFitToContent is false.
	public double Padding { get; init; } = 10.0;

	// Optional CSS color value (e.g. "white" or "#fff"). When set, a <rect width=100%
	// height=100% fill='...' /> is emitted before the content group.
	public string BackgroundColor { get; init; }

	// font-family stack inherited by all <text> elements in the content group.
	public string FontFamily { get; init; } = DefaultFontFamily;

	// Embed bundled Inter fonts as @font-face data URIs. Off by default to keep parity
	// with legacy output; Phase 4 turns this on once font metrics are wired up.
	public bool EmbedFonts { get; init; }

	// Title for the SVG <title> element. When null, falls back to Document.Metadata.Title
	// or Page.Title; when empty string, no <title> is emitted.
	public string Title { get; init; }
}
