using System.IO;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Import.Svg;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Rendering.Pdf;

namespace Selva.Drawing.Tests.Import;

// Guards against a regression where SVG images silently didn't render to PDF: the raster
// ImageElement path skipped them, since SVG needs to be imported into DrawElements first.
public class SvgToPdfIntegrationTests
{
    [Fact]
    public void Imported_svg_renders_into_a_valid_pdf()
    {
        var svg =
            "<svg width='100' height='100'>" +
            "<rect x='10' y='10' width='80' height='80' fill='#cccccc' stroke='black' stroke-width='1'/>" +
            "<path d='M20 20 L80 20 L50 70 Z' fill='red'/>" +
            "</svg>";

        var imported = new SvgImporter().Import(svg);
        Assert.NotNull(imported);

        var doc = new Document { Pages = new[] { new Page { Content = imported } } };
        var bytes = new PdfRenderer().Render(doc);

        Assert.True(bytes.Length > 4);
        using var ms = new MemoryStream(bytes);
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
        Assert.Equal(1, reopened.PageCount);
    }
}
