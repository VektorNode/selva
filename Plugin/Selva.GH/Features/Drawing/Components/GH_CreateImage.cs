using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Rhino.Geometry;
using Selva.Drawing.Import.Svg;
using Selva.Drawing.Model.Elements;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using DrawPoint = Selva.Drawing.Model.Geometry.Point2D;
using DrawTransform = Selva.Drawing.Model.Geometry.Transform;

namespace Selva.GH.Features.Drawing.Components;

// Places an image (from a Get Image input, or a path/url/base64 string) into the drawing,
// sized in document units, and flows into Render PDF / Render SVG like any other DrawElement.
// PNG/JPEG/WEBP embed as a raster ImageElement (both targets). SVG is translated into native
// drawing geometry (paths/shapes/groups) so it renders losslessly to both PDF and SVG —
// unsupported SVG features (gradients, filters, text) are skipped with a warning.
public class GH_CreateImage : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateImage()
        : base("Draw Image", "DImg",
            "Places an image into the drawing at a position and size (document units)",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.CreateFile;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("C2E8B1A4-7D3F-4C6E-9B25-8F1D3A7E0C9B");

    public override bool IsPreviewCapable => true;
    public override BoundingBox ClippingBox => _preview.ClippingBox;

    public override void ClearData()
    {
        base.ClearData();
        _preview.Clear();
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || Hidden) return;
        _preview.Render(args);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Image", "I", "Image from a Get Image input, or a path / URL / base64 string", GH_ParamAccess.item);
        pManager.AddPointParameter("Position", "P", "Bottom-left corner in world XY space (document units). Defaults to the origin; layout containers or downstream placement may override it.", GH_ParamAccess.item, Point3d.Origin);
        pManager.AddNumberParameter("Width", "W", "Image width in document units. Leave empty to size from Height (aspect-preserved) or from the image's intrinsic size.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Height", "H", "Image height in document units. Leave empty to size from Width (aspect-preserved) or from the image's intrinsic size.", GH_ParamAccess.item);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        IGH_Goo imageGoo = null;
        var position = Point3d.Origin;
        double width = 0;
        double height = 0;

        if (!DA.GetData(0, ref imageGoo) || imageGoo == null) return;
        // Position is optional and defaults to the origin; an unset point also maps to origin.
        DA.GetData(1, ref position);
        if (position == Point3d.Unset) position = Point3d.Origin;
        var hasWidth = DA.GetData(2, ref width);
        var hasHeight = DA.GetData(3, ref height);

        if (hasWidth && width <= 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Width must be positive");
            return;
        }

        if (hasHeight && height <= 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Height must be positive");
            return;
        }

        var fileData = ExtractFileInputData(imageGoo);
        if (fileData == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Could not read image input");
            return;
        }

        var resolved = ImageInputResolver.Resolve(fileData);
        if (!resolved.Success)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, resolved.ErrorMessage);
            return;
        }

        // SVG translates into real drawing geometry so it renders losslessly to BOTH SVG and
        // PDF (no rasterisation). Raster formats embed as an ImageElement.
        DrawElement element = resolved.Format == ImageFormat.Svg
            ? BuildSvgElement(resolved.Data, position, hasWidth, hasHeight, width, height)
            : BuildRasterElement(resolved.Data, resolved.Format, position, hasWidth, hasHeight, width, height);

        if (element == null) return; // a warning was already raised

        _preview.Add(element);
        DA.SetData(0, element);
    }

    private DrawElement BuildRasterElement(byte[] data, ImageFormat format, Point3d position,
        bool hasWidth, bool hasHeight, double width, double height)
    {
        if (!ResolveSize(data, format, hasWidth, hasHeight, ref width, ref height))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Could not read the image's intrinsic size; specify Width and/or Height.");
            return null;
        }

        return new ImageElement
        {
            Data = data,
            Format = format,
            Position = new DrawPoint(position.X, position.Y),
            Width = width,
            Height = height,
        };
    }

    private DrawElement BuildSvgElement(byte[] data, Point3d position,
        bool hasWidth, bool hasHeight, double width, double height)
    {
        string markup;
        try
        {
            markup = System.Text.Encoding.UTF8.GetString(data);
        }
        catch
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Could not decode SVG data");
            return null;
        }

        var importer = new SvgImporter();
        DrawElement imported;
        try
        {
            imported = importer.Import(markup);
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Could not import SVG: {ex.Message}");
            return null;
        }

        foreach (var w in importer.Warnings)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, w);
        }

        if (imported == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "SVG contained no importable geometry");
            return null;
        }

        // The imported geometry sits in the SVG's own coordinate space. Scale it to the
        // requested Width/Height (aspect-preserved when only one is given; intrinsic 1:1 when
        // neither), then translate so its bottom-left lands at Position.
        var bounds = imported.ComputeBounds();
        if (bounds.IsEmpty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "SVG geometry has no extent");
            return null;
        }

        var srcW = bounds.Width > 0 ? bounds.Width : 1.0;
        var srcH = bounds.Height > 0 ? bounds.Height : 1.0;

        double scaleX, scaleY;
        if (hasWidth && hasHeight) { scaleX = width / srcW; scaleY = height / srcH; }
        else if (hasWidth) { scaleX = scaleY = width / srcW; }
        else if (hasHeight) { scaleX = scaleY = height / srcH; }
        else { scaleX = scaleY = 1.0; } // intrinsic SVG units → document units 1:1

        // Compose: move source min to origin, scale, then move to Position.
        var t = DrawTransform.Translate(position.X, position.Y)
            .Multiply(DrawTransform.Scale(scaleX, scaleY))
            .Multiply(DrawTransform.Translate(-bounds.MinX, -bounds.MinY));

        return new GroupElement { Transform = t, Children = new[] { imported } };
    }

    // CSS reference: 96 device pixels per inch, 25.4 mm per inch. Used to turn a raster
    // image's intrinsic pixel size into document millimetres when no size is given, so a
    // 1920px photo lands at ~508mm rather than 1920mm. Layout containers (Frame/Stack/Grid)
    // then size around that box; set Width/Height to override.
    private const double MmPerPixelAt96Dpi = 25.4 / 96.0;

    /// <summary>
    ///     Fills in missing Width/Height from the image's intrinsic dimensions, preserving
    ///     aspect ratio. Both supplied → stretch to fit (no change). One supplied → scale the
    ///     other. Neither → use the intrinsic size (raster px converted to mm at 96 DPI; SVG
    ///     user units 1:1). Returns false only when a dimension is needed but the intrinsic
    ///     size couldn't be read.
    /// </summary>
    private static bool ResolveSize(byte[] data, ImageFormat format, bool hasWidth, bool hasHeight,
        ref double width, ref double height)
    {
        if (hasWidth && hasHeight) return true;

        if (!ImageDimensions.TryGet(data, format, out var intrinsicW, out var intrinsicH)
            || intrinsicW <= 0 || intrinsicH <= 0)
        {
            return false;
        }

        var aspect = intrinsicW / intrinsicH;

        if (hasWidth)
        {
            height = width / aspect;
        }
        else if (hasHeight)
        {
            width = height * aspect;
        }
        else
        {
            // SVG dimensions are already design units; raster dimensions are device pixels.
            var scale = format == ImageFormat.Svg ? 1.0 : MmPerPixelAt96Dpi;
            width = intrinsicW * scale;
            height = intrinsicH * scale;
        }

        return true;
    }

    private static FileInputData ExtractFileInputData(IGH_Goo goo)
    {
        switch (goo)
        {
            case FileInputGoo fileGoo:
                return fileGoo.Value;
            case GH_String ghString:
                return TryParse(ghString.Value);
            default:
                return TryParse(goo.ScriptVariable()?.ToString());
        }
    }

    private static FileInputData TryParse(string str)
    {
        if (string.IsNullOrEmpty(str)) return null;

        // A Get Image input serializes FileInputData as JSON; a bare string is a path.
        try
        {
            var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None, MaxDepth = 8 };
            var data = JsonConvert.DeserializeObject<FileInputData>(str, settings);
            if (data != null && !string.IsNullOrEmpty(data.File)) return data;
        }
        catch (JsonException)
        {
            // Not JSON — treat as a path below.
        }

        return FileInputData.FromPath(str);
    }
}
