using System.Collections.Generic;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using ModelBoundingBox = Selva.Drawing.Model.Geometry.BoundingBox;

namespace Selva.GH.Features.Drawing.Components;

// A single Document input passes through; anything else is treated as loose DrawElements
// and wrapped into a one-page document.
public static class RenderDocumentInput
{
    public static bool TryBuildDocument(List<IGH_Goo> inputs, string title,
        out Document doc, out bool wasLoose, out string error)
    {
        wasLoose = false;
        if (inputs.Count == 1 && Unwrap(inputs[0]) is Document existing)
        {
            doc = existing;
            error = null;
            return true;
        }

        var elements = new List<DrawElement>(inputs.Count);
        foreach (var item in inputs)
        {
            switch (Unwrap(item))
            {
                case null:
                    continue;
                case DrawElement element:
                    elements.Add(element);
                    break;
                case Document _:
                    doc = null;
                    error = "Mixing a Document with loose drawing elements is not supported. Wire either a single Document or one or more drawing elements.";
                    return false;
                default:
                    doc = null;
                    error = $"Unsupported input type: {item?.GetType().Name ?? "null"}";
                    return false;
            }
        }

        if (elements.Count == 0)
        {
            doc = null;
            error = "No content provided";
            return false;
        }

        DrawElement content = elements.Count == 1
            ? elements[0]
            : new GroupElement { Children = elements };

        doc = new Document
        {
            Metadata = new DocumentMetadata { Title = title },
            Pages = new[]
            {
                new Page
                {
                    Title = title,
                    Content = content,
                },
            },
        };
        wasLoose = true;
        error = null;
        return true;
    }

    // Loose elements keep their world coordinates; without Auto Fit the output window is the
    // default page rect, so geometry at model coordinates renders cropped or blank with no
    // other signal.
    public static string LoosePageFitWarning(Document doc)
    {
        if (doc?.Pages == null || doc.Pages.Count == 0) return null;
        var page = doc.Pages[0];
        ModelBoundingBox bounds;
        try { bounds = page.Content?.ComputeBounds() ?? ModelBoundingBox.Empty; }
        catch { return null; }
        if (bounds.IsEmpty) return null;

        var pageRect = new ModelBoundingBox(0, 0, page.Size.WidthMm, page.Size.HeightMm);
        var disjoint = bounds.MinX >= pageRect.MaxX || bounds.MaxX <= pageRect.MinX
            || bounds.MinY >= pageRect.MaxY || bounds.MaxY <= pageRect.MinY;
        if (disjoint)
            return $"Content lies entirely outside the {page.Size.Name ?? "default"} page area — the output will look blank. Enable Auto Fit or move the geometry near the origin.";

        var contained = bounds.MinX >= pageRect.MinX && bounds.MaxX <= pageRect.MaxX
            && bounds.MinY >= pageRect.MinY && bounds.MaxY <= pageRect.MaxY;
        if (!contained)
            return "Content extends outside the page area and will be cropped — enable Auto Fit to size the page to the content.";

        return null;
    }

    private static object Unwrap(IGH_Goo goo) => goo switch
    {
        null => null,
        GH_ObjectWrapper wrap => wrap.Value,
        _ => goo,
    };
}
