namespace Selva.Drawing.Rendering.Pdf;

// PdfSharpCore picks the colour operator per content stream (`rg/RG` for RGB, `k/K` for
// CMYK) from this mode, set once for the whole document — no per-page override. Choose
// `Cmyk` for print-shop output, `Rgb` (default) for screen/digital.
public enum PdfColorMode { Rgb, Cmyk }

// Configures PdfRenderer. PDF has no "background color" option because pages are paper —
// callers can add a filled rect as the first page element if they want one.
public sealed class PdfRenderOptions
{
	// Auto-fit the page to the union of element bounds plus Padding on each side. When
	// false, the page uses Page.Size (paper dimensions in mm).
	public bool AutoFitToContent { get; init; } = true;

	public double Padding { get; init; } = 10.0;

	// Falls through to the IFontResolver chain when an element's Style.FontFamily isn't bundled.
	public string FontFamily { get; init; } = "Inter";

	// Emits an XMP metadata stream alongside the legacy /Info dictionary. Required by
	// document-management systems and modern readers (Acrobat preflight, PDF/A).
	public bool EmitXmpMetadata { get; init; } = true;

	// PDF outlines (bookmarks): one top-level outline per Page (Page.Title, or "Page N"
	// when blank), nested outlines for any DrawingView with a non-empty Caption.
	public bool EmitOutlines { get; init; } = true;

	// Clickable link annotations for any TextElement with a Hyperlink URL. TextElements
	// without one produce no annotation, so this costs nothing for link-free documents.
	public bool EmitHyperlinks { get; init; } = true;

	// `Cmyk` is required for print-shop preflight in Acrobat (RGB triggers warnings).
	// PdfSharpCore has no per-page override, so a mixed-mode document needs two render passes.
	public PdfColorMode ColorMode { get; init; } = PdfColorMode.Rgb;
}
