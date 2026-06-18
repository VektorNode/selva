using GH_IO.Serialization;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Rhino.Display;
using Rhino.Geometry;
using Selva.GH.Features.ComputeIO;
using Selva.GH.Features.Display.Services;

namespace Selva.GH.Features.Display.Goos;

/// <summary>
///     Grasshopper Goo wrapper for WebDisplay data to prevent double JSON encoding.
///
///     Derives from <see cref="GH_GeometricGoo{T}" /> (not plain <see cref="GH_Goo{T}" />) so the
///     dedicated <c>Param_WebDisplay</c> can derive from <c>GH_PersistentGeometryParam</c> and get
///     Grasshopper's native param preview — a plain persistent param's IGH_PreviewObject draw methods
///     are never invoked by GH. Implements <see cref="IGH_PreviewData" /> to actually draw; the
///     drawable geometry is reconstructed from the encoded batch (the Goo carries only the quantized
///     blob + JSON items) and cached on first draw.
///
///     The batch is baked display data, not editable geometry, so the geometric-goo transform/morph
///     operations are identity no-ops — Selva never spatially transforms a Web Display in GH.
/// </summary>
public class WebDisplayGoo : GH_GeometricGoo<DisplayBatch>, ISelvaSerializableGoo, IGH_PreviewData
{
    private WebDisplayPreview _preview;

    public WebDisplayGoo()
    {
    }

    public WebDisplayGoo(DisplayBatch value)
    {
        Value = value;
    }

    private WebDisplayPreview Preview => _preview ??= WebDisplayPreview.Build(Value);

    // ── IGH_GeometricGoo ────────────────────────────────────────────────────────────────────────

    public override string TypeName => "WebDisplay";

    public override string TypeDescription => "Geometry data for web display";

    public override BoundingBox Boundingbox => IsValid ? Preview.BoundingBox : BoundingBox.Empty;

    public override bool IsValid => Value != null && Value.Materials != null && Value.Groups != null;

    public override BoundingBox GetBoundingBox(Transform xform)
    {
        if (!IsValid)
        {
            return BoundingBox.Empty;
        }

        var bb = Preview.BoundingBox;
        bb.Transform(xform);
        return bb;
    }

    public override IGH_GeometricGoo DuplicateGeometry()
    {
        return new WebDisplayGoo(Value);
    }

    // A Web Display is baked display data — spatial transform/morph don't apply, so return self.
    public override IGH_GeometricGoo Transform(Transform xform)
    {
        return new WebDisplayGoo(Value);
    }

    public override IGH_GeometricGoo Morph(SpaceMorph xmorph)
    {
        return new WebDisplayGoo(Value);
    }

    // ── IGH_PreviewData ─────────────────────────────────────────────────────────────────────────

    public BoundingBox ClippingBox => IsValid ? Preview.BoundingBox : BoundingBox.Empty;

    public void DrawViewportMeshes(GH_PreviewMeshArgs args)
    {
        if (!IsValid)
        {
            return;
        }

        foreach (var (mesh, color) in Preview.Meshes)
        {
            var material = new DisplayMaterial(color) { IsTwoSided = true };
            args.Pipeline.DrawMeshShaded(mesh, material);
        }
    }

    public void DrawViewportWires(GH_PreviewWireArgs args)
    {
        if (!IsValid)
        {
            return;
        }

        foreach (var (curve, color) in Preview.Curves)
        {
            args.Pipeline.DrawCurve(curve, color, args.Thickness);
        }

        foreach (var (point, color) in Preview.Points)
        {
            args.Pipeline.DrawPoint(point, PointStyle.RoundSimple, 4, color);
        }
    }

    public override IGH_Goo Duplicate()
    {
        return new WebDisplayGoo(Value);
    }

    public override string ToString()
    {
        if (!IsValid)
        {
            return "Invalid WebDisplay";
        }

        return $"WebDisplay: {Value.Materials.Count} materials, {Value.Groups.Count} groups";
    }

    public override bool Write(GH_IWriter writer)
    {
        if (!IsValid)
        {
            return false;
        }

        var json = JsonConvert.SerializeObject(Value);
        writer.SetString("WebDisplayJson", json);
        return true;
    }

    public override bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("WebDisplayJson"))
        {
            return false;
        }

        var json = reader.GetString("WebDisplayJson");
        Value = JsonConvert.DeserializeObject<DisplayBatch>(json);
        return true;
    }

    public override bool CastFrom(object source)
    {
        if (source is DisplayBatch batch)
        {
            Value = batch;
            return true;
        }

        if (source is GH_String ghString)
        {
            try
            {
                Value = JsonConvert.DeserializeObject<DisplayBatch>(ghString.Value);
                return true;
            }
            catch
            {
                return false;
            }
        }

        return false;
    }

    public override bool CastTo<Q>(ref Q target)
    {
        if (typeof(Q).IsAssignableFrom(typeof(DisplayBatch)))
        {
            target = (Q)(object)Value;
            return true;
        }

        if (typeof(Q).IsAssignableFrom(typeof(GH_String)))
        {
            var json = JsonConvert.SerializeObject(Value);
            target = (Q)(object)new GH_String(json);
            return true;
        }

        if (typeof(Q).IsAssignableFrom(typeof(string)))
        {
            var json = JsonConvert.SerializeObject(Value);
            target = (Q)(object)json;
            return true;
        }

        return false;
    }

    public override object ScriptVariable()
    {
        // Return the JSON string directly for script access
        // This prevents double-encoding when accessed via GHPython or file I/O
        return JsonConvert.SerializeObject(Value);
    }

    // ISelvaSerializableGoo — Rhino.Compute returns this payload. DisplayBatch is a web-ready DTO
    // (geometry already converted by BinaryGeometryWriter), so default settings match the Goo's
    // own serialization (Write/ScriptVariable).
    public string ToComputeJson()
    {
        return JsonConvert.SerializeObject(Value);
    }
}
