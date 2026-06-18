using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;

namespace Selva.GH.Features.Display.Params;

/// <summary>
///     Dedicated Grasshopper parameter for <see cref="WebDisplayGoo" />. Beyond a typed wire, it is:
///     - persistent (<see cref="GH_PersistentGeometryParam{T}" />), so a Web Display can be
///       internalized into the .gh file via the right-click "Internalise data" menu — a third way to
///       persist a display alongside cloud solving and the .dmf file;
///     - preview-capable: it computes its clipping box and draws directly from its own data,
///       dispatching to each held <see cref="WebDisplayGoo" />'s <c>IGH_PreviewData</c> methods. The
///       inherited Preview_* helpers were not used because they did not query the held goo's bbox
///       (they returned an empty box, so Grasshopper skipped drawing the param entirely).
/// </summary>
public class Param_WebDisplay : GH_PersistentGeometryParam<WebDisplayGoo>, IGH_PreviewObject
{
    private bool _hidden;

    public Param_WebDisplay()
        : base(new GH_InstanceDescription(
            "Param Web Display", "PWD",
            "Geometry data for web display (meshes, curves, points) produced by the Display component",
            "Selva", "Display"))
    {
    }

    public Param_WebDisplay(GH_InstanceDescription tag) : base(tag)
    {
    }

    public Param_WebDisplay(
        string name, string nickname, string description,
        string category, string subcategory,
        GH_ParamAccess access)
        : base(new GH_InstanceDescription(name, nickname, description, category, subcategory))
    {
        Access = access;
    }

    protected override Bitmap Icon => Properties.Resources.WebDisplay;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("D5E8F1A3-6B7C-4D2E-9F01-2A3B4C5D6E7F");

    // IGH_PreviewObject — the GH_PersistentGeometryParam base supplies the preview behaviour; we
    // expose the hidden flag so the per-object preview toggle works.
    public bool Hidden
    {
        get => _hidden;
        set => _hidden = value;
    }

    public bool IsPreviewCapable => true;

    public Rhino.Geometry.BoundingBox ClippingBox
    {
        get
        {
            // Compute from our own data directly. The inherited Preview_ComputeClippingBox helper
            // wasn't querying the held goo's bbox (it returned an empty box, so GH skipped drawing).
            var bb = Rhino.Geometry.BoundingBox.Empty;
            foreach (var goo in PreviewGoos())
            {
                bb.Union(goo.ClippingBox);
            }

            return bb;
        }
    }

    public void DrawViewportMeshes(IGH_PreviewArgs args)
    {
        if (_hidden || Locked)
        {
            return;
        }

        var meshArgs = new GH_PreviewMeshArgs(args.Viewport, args.Display, args.ShadeMaterial,
            args.MeshingParameters);
        foreach (var goo in PreviewGoos())
        {
            goo.DrawViewportMeshes(meshArgs);
        }
    }

    public void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (_hidden || Locked)
        {
            return;
        }

        var wireArgs = new GH_PreviewWireArgs(args.Viewport, args.Display, args.WireColour,
            args.DefaultCurveThickness);
        foreach (var goo in PreviewGoos())
        {
            goo.DrawViewportWires(wireArgs);
        }
    }

    /// <summary>
    ///     The WebDisplayGoo values to preview: wired data lives in VolatileData; internalized data in
    ///     PersistentData when no upstream solve has copied it across.
    /// </summary>
    private IEnumerable<WebDisplayGoo> PreviewGoos()
    {
        if (VolatileData != null && !VolatileData.IsEmpty)
        {
            foreach (var item in VolatileData.AllData(true))
            {
                if (item is WebDisplayGoo goo && goo.IsValid)
                {
                    yield return goo;
                }
            }

            yield break;
        }

        if (PersistentData != null && !PersistentData.IsEmpty)
        {
            foreach (var item in PersistentData.AllData(true))
            {
                if (item is WebDisplayGoo goo && goo.IsValid)
                {
                    yield return goo;
                }
            }
        }
    }

    protected override WebDisplayGoo InstantiateT()
    {
        return new WebDisplayGoo();
    }

    // No interactive prompts: a Web Display can't be typed or picked, only wired or internalized.
    protected override GH_GetterResult Prompt_Singular(ref WebDisplayGoo value)
    {
        return GH_GetterResult.cancel;
    }

    protected override GH_GetterResult Prompt_Plural(ref List<WebDisplayGoo> values)
    {
        return GH_GetterResult.cancel;
    }
}
