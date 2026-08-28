using System.Linq;
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
///     Grasshopper Goo wrapper for a <see cref="DisplayBatch" />.
///
///     Derives from <see cref="GH_GeometricGoo{T}" /> (not plain <see cref="GH_Goo{T}" />) so the
///     dedicated <c>Param_WebDisplay</c> can derive from <c>GH_PersistentGeometryParam</c> and get
///     Grasshopper's native param preview — a plain persistent param's IGH_PreviewObject draw methods
///     are never invoked by GH. Implements <see cref="IGH_PreviewData" /> to draw; the drawable
///     geometry is reconstructed from the encoded batch and cached on first draw.
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

    /// <summary>
    ///     Joins every decoded mesh in the batch into a single mesh for a single-item cast. Returns
    ///     false when the batch has no meshes (e.g. a curves/points-only batch) or when the join
    ///     produced an invalid mesh.
    ///
    ///     Appends the whole sequence in one call: appending mesh-by-mesh regrows the vertex and
    ///     face lists on every iteration, which is quadratic over a batch of thousands of meshes.
    /// </summary>
    private bool TryJoinMeshes(out Mesh joined)
    {
        joined = null;
        if (Preview.Meshes.Count == 0)
        {
            return false;
        }

        joined = new Mesh();
        joined.Append(Preview.Meshes.Select(entry => entry.mesh));

        // A batch can exceed what one Mesh can hold. Faces.Count > 0 does not catch that: a mesh
        // whose faces index past its vertex list still reports faces, and casting it hands
        // Grasshopper geometry that fails downstream with no indication of where it came from.
        if (!joined.IsValid)
        {
            joined = null;
            return false;
        }

        return joined.Faces.Count > 0;
    }

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

    // A Web Display holds baked geometry (quantized mesh blob + curve/point JSON), not live Rhino
    // geometry, but Move/Rotate/Scale/Orient should still relocate it like any other geometric goo.
    // The transformer decodes, moves, and re-encodes a fresh batch; the new goo rebuilds its preview
    // lazily (its _preview starts null).
    public override IGH_GeometricGoo Transform(Transform xform)
    {
        return IsValid ? new WebDisplayGoo(DisplayBatchTransformer.Transform(Value, xform)) : this;
    }

    public override IGH_GeometricGoo Morph(SpaceMorph xmorph)
    {
        return IsValid ? new WebDisplayGoo(DisplayBatchTransformer.Morph(Value, xmorph)) : this;
    }

    // ── IGH_PreviewData ─────────────────────────────────────────────────────────────────────────

    public BoundingBox ClippingBox => IsValid ? Preview.BoundingBox : BoundingBox.Empty;

    public void DrawViewportMeshes(GH_PreviewMeshArgs args)
    {
        DrawViewportMeshes(args, false);
    }

    /// <summary>
    ///     Draws the batch meshes. When <paramref name="selected" /> is true, the GH selection shade
    ///     material from <c>args.Material</c> overrides each mesh's own batch color so a selected Web
    ///     Display turns green like any other geometry; otherwise each mesh draws in its own color.
    /// </summary>
    public void DrawViewportMeshes(GH_PreviewMeshArgs args, bool selected)
    {
        if (!IsValid)
        {
            return;
        }

        foreach (var (mesh, color) in Preview.Meshes)
        {
            var material = selected
                ? args.Material
                : new DisplayMaterial(color) { IsTwoSided = true };
            args.Pipeline.DrawMeshShaded(mesh, material);
        }
    }

    public void DrawViewportWires(GH_PreviewWireArgs args)
    {
        DrawViewportWires(args, false);
    }

    /// <summary>
    ///     Draws the batch curves/points. When <paramref name="selected" /> is true, the GH selection
    ///     wire color from <c>args.Color</c> overrides each item's own color.
    /// </summary>
    public void DrawViewportWires(GH_PreviewWireArgs args, bool selected)
    {
        if (!IsValid)
        {
            return;
        }

        foreach (var (curve, color) in Preview.Curves)
        {
            args.Pipeline.DrawCurve(curve, selected ? args.Color : color, args.Thickness);
        }

        foreach (var (point, color) in Preview.Points)
        {
            args.Pipeline.DrawPoint(point, PointStyle.RoundSimple, 4, selected ? args.Color : color);
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
        BackfillCurvePoints(Value);
        return true;
    }

    /// <summary>
    ///     Tessellates curve items saved before the plugin did it server-side. Those carry NURBS
    ///     <c>Json</c> but no <c>Points</c>, and the web renders only from <c>Points</c> — without
    ///     this, reopening such a definition solves fine in Rhino and then fails in the viewer.
    ///     Rebuilding here is free: the NURBS is already in hand.
    ///
    ///     TRANSITIONAL — delete once no definition in circulation predates tessellated curves.
    ///     Re-saving a definition through any current plugin build makes its batch self-sufficient,
    ///     so this only serves <c>.gh</c> files not opened since the upgrade. Removing it early is
    ///     not silent: such a file starts failing in the viewer with an upgrade message instead.
    ///     Delete this method, both call sites, and the <c>untessellated</c> warning in
    ///     <c>WebSocketTransport</c> together.
    /// </summary>
    internal static void BackfillCurvePoints(DisplayBatch batch)
    {
        if (batch?.Items == null)
        {
            return;
        }

        foreach (var item in batch.Items)
        {
            if (item?.Kind != "curve" || item.Points != null || string.IsNullOrEmpty(item.Json))
            {
                continue;
            }

            if (GeometryBase.FromJSON(item.Json) is Curve curve)
            {
                item.Points = CurveTessellator.Tessellate(curve);
            }
        }
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
                BackfillCurvePoints(Value);
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

        // Decode the baked batch back to Rhino geometry so a Web Display can be wired straight into a
        // Mesh/Curve/Point param. A batch can hold many meshes; a single-item cast joins them into one
        // (standard GH single-cast behaviour). Curve/point casts take the first item of that kind.
        if (IsValid)
        {
            if (typeof(Q).IsAssignableFrom(typeof(GH_Mesh)) && TryJoinMeshes(out var joined))
            {
                target = (Q)(object)new GH_Mesh(joined);
                return true;
            }

            if (typeof(Q).IsAssignableFrom(typeof(Mesh)) && TryJoinMeshes(out var rawMesh))
            {
                target = (Q)(object)rawMesh;
                return true;
            }

            if (typeof(Q).IsAssignableFrom(typeof(GH_Curve)) && Preview.Curves.Count > 0)
            {
                target = (Q)(object)new GH_Curve(Preview.Curves[0].curve);
                return true;
            }

            if (typeof(Q).IsAssignableFrom(typeof(Curve)) && Preview.Curves.Count > 0)
            {
                target = (Q)(object)Preview.Curves[0].curve;
                return true;
            }

            if (typeof(Q).IsAssignableFrom(typeof(GH_Point)) && Preview.Points.Count > 0)
            {
                target = (Q)(object)new GH_Point(Preview.Points[0].point);
                return true;
            }

            if (typeof(Q).IsAssignableFrom(typeof(Point3d)) && Preview.Points.Count > 0)
            {
                target = (Q)(object)Preview.Points[0].point;
                return true;
            }
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
        // Returns the JSON string directly, not a re-wrapped object — otherwise GHPython/file I/O
        // would serialize it a second time on top.
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
