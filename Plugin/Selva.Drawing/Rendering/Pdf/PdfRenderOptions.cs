namespace Selva.Drawing.Rendering.Pdf;

// Controls how colours are written to the rendered PDF. PdfSharpCore picks the operator
// per content stream (`rg/RG` for RGB, `k/K` for CMYK) based on this mode — at the
// document level only, with no per-page override. For print-shop output choose `Cmyk`;
// for screen/digital choose `Rgb` (default). RGB sources get converted on emit when the
// document mode is `Cmyk` and vice-versa.
public enum PdfColorMode { Rgb, Cmyk }

// Configures PdfRenderer. Mirrors SvgRenderOptions where it makes sense; PDF has no
// "background color" because pages are paper (callers can add a filled rect as the first
// element of the page if they want).
public sealed class PdfRenderOptions
{
	// Auto-fit the page to the union of element bounds plus Padding on each side. Matches
	// the SvgRenderer default. When false, the page uses Page.Size (paper dimensions in mm).
	public bool AutoFitToContent { get; init; } = true;

	// Padding around the auto-fit content bounds, in millimetres.
	public double Padding { get; init; } = 10.0;

	// Default font family used when an element's Style.FontFamily isn't bundled.
	// PdfSharpCore will fall through to the IFontResolver chain.
	public string FontFamily { get; init; } = "Inter";

	// Phase 9 (print-grade PDF):

	// Emit an XMP metadata stream alongside the legacy /Info dictionary. Required by
	// document-management systems and modern PDF readers (Acrobat preflight, PDF/A).
	// Default on — overhead is ~1 KB per document and there's no downside.
	public bool EmitXmpMetadata { get; init; } = true;

	// Emit PDF outlines (bookmarks). One top-level outline per Page (using Page.Title or
	// "Page N" when blank); nested outlines for any DrawingView with a non-empty Caption.
	// Default on — gives readers a navigable sidebar at zero cost.
	public bool EmitOutlines { get; init; } = true;

	// Emit clickable link annotations for any TextElement that carries a Hyperlink URL.
	// Default on — the underlying field is opt-in (only TextElements that set Hyperlink
	// produce annotations), so leaving this on costs nothing for documents without links.
	public bool EmitHyperlinks { get; init; } = true;

	// PDF colour mode. `Rgb` (default) writes all colours via /DeviceRGB operators;
	// `Cmyk` writes them via /DeviceCMYK. CMYK is required for print-shop preflight in
	// Acrobat (RGB triggers warnings). Set per document; PdfSharpCore has no per-page
	// override, so a mixed-mode document needs two render passes.
	public PdfColorMode ColorMode { get; init; } = PdfColorMode.Rgb;
}
