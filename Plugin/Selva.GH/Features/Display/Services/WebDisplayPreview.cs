using System.Collections.Generic;
using System.Drawing;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Reconstructs drawable Rhino geometry from a <see cref="DisplayBatch" /> for viewport preview.
///     The batch carries only the encoded mesh blob (quantized) plus JSON curve/point items, so the
///     param has no original Rhino geometry to draw — this rebuilds it: dequantized meshes per group,
///     curves from their serialized NURBS JSON (falling back to their tessellated points), and
///     points from their stored positions.
/// </summary>
public sealed class WebDisplayPreview
{
    public List<(Mesh mesh, Color color)> Meshes { get; } = new List<(Mesh, Color)>();
    public List<(Curve curve, Color color)> Curves { get; } = new List<(Curve, Color)>();
    public List<(Point3d point, Color color)> Points { get; } = new List<(Point3d, Color)>();

    // BoundingBox is a struct: accumulate into a field and union explicitly. (Calling .Union on an
    // auto-property getter would mutate a discarded copy, leaving the box Empty — which previously
    // gave the preview an empty clipping box and made Grasshopper skip drawing the param entirely.)
    private BoundingBox _boundingBox = BoundingBox.Empty;
    public BoundingBox BoundingBox => _boundingBox;

    public static WebDisplayPreview Build(DisplayBatch batch)
    {
        var preview = new WebDisplayPreview();
        if (batch == null)
        {
            return preview;
        }

        preview.BuildMeshes(batch);
        preview.BuildItems(batch);
        return preview;
    }

    private void BuildMeshes(DisplayBatch batch)
    {
        if (batch.CompressedData == null || batch.CompressedData.Length == 0 || batch.Groups == null)
        {
            return;
        }

        BinaryGeometryReader.Result decoded;
        try
        {
            decoded = BinaryGeometryReader.Read(batch.CompressedData);
        }
        catch
        {
            // A malformed blob shouldn't break the preview — just draw nothing.
            return;
        }

        var verts = decoded.Vertices;
        var indices = decoded.Indices;

        foreach (var group in batch.Groups)
        {
            var color = MaterialColor(batch, group.MaterialId);
            if (group.Meshes == null)
            {
                continue;
            }

            foreach (var meshMeta in group.Meshes)
            {
                var mesh = BuildMesh(verts, indices, decoded.Colors, meshMeta);
                if (mesh == null)
                {
                    continue;
                }

                Meshes.Add((mesh, color));
                _boundingBox.Union(mesh.GetBoundingBox(false));
            }
        }
    }

    private static Mesh BuildMesh(float[] verts, int[] indices, byte[] colors, MeshMetadata meta)
    {
        var mesh = new Mesh();

        // Vertices for this sub-mesh are a contiguous slice; indices are global, so subtract the
        // slice's base to localize them.
        var vStart = meta.VertexStart;
        for (var v = 0; v < meta.VertexCount; v++)
        {
            var c = (vStart + v) * 3;
            mesh.Vertices.Add(verts[c], verts[c + 1], verts[c + 2]);
        }

        // Vertex colors ride the blob batch-wide when any mesh has them (white fill elsewhere);
        // put them back so rendered viewport modes show the same gradients as the web.
        if (colors != null)
        {
            for (var v = 0; v < meta.VertexCount; v++)
            {
                var c = (vStart + v) * 3;
                mesh.VertexColors.Add(colors[c], colors[c + 1], colors[c + 2]);
            }
        }

        var iStart = meta.IndexStart;
        var iEnd = iStart + meta.IndexCount;
        for (var i = iStart; i + 2 < iEnd; i += 3)
        {
            mesh.Faces.AddFace(indices[i] - vStart, indices[i + 1] - vStart, indices[i + 2] - vStart);
        }

        if (mesh.Faces.Count == 0)
        {
            return null;
        }

        mesh.Normals.ComputeNormals();
        mesh.Compact();
        return mesh;
    }

    private void BuildItems(DisplayBatch batch)
    {
        if (batch.Items == null)
        {
            return;
        }

        foreach (var item in batch.Items)
        {
            if (item == null)
            {
                continue;
            }

            var color = item.Color != null ? ColorTranslator.FromHtml(item.Color) : Color.White;

            if (item.Kind == "curve" && !string.IsNullOrEmpty(item.Json))
            {
                if (GeometryBase.FromJSON(item.Json) is Curve curve)
                {
                    Curves.Add((curve, color));
                    _boundingBox.Union(curve.GetBoundingBox(false));
                }
            }
            else if (item.Kind == "curve" && item.Points != null)
            {
                // Faceted next to the NURBS the Json branch rebuilds, but a visible preview beats
                // none — this is the shape a transformed batch carries.
                var polyline = ToPolyline(item.Points);
                if (polyline != null)
                {
                    Curves.Add((polyline, color));
                    _boundingBox.Union(polyline.GetBoundingBox(false));
                }
            }
            else if (item.Kind == "point" && item.Position != null)
            {
                var pt = new Point3d(item.Position.X, item.Position.Y, item.Position.Z);
                Points.Add((pt, color));
                _boundingBox.Union(new BoundingBox(pt, pt));
            }
        }
    }

    /// <summary>
    ///     Flat <c>[x,y,z, …]</c> to a polyline curve, or null if there are fewer than two vertices.
    /// </summary>
    private static Curve ToPolyline(double[] points)
    {
        if (points == null || points.Length < 6)
        {
            return null;
        }

        var vertices = new List<Point3d>(points.Length / 3);
        for (var i = 0; i + 2 < points.Length; i += 3)
        {
            vertices.Add(new Point3d(points[i], points[i + 1], points[i + 2]));
        }

        return new Polyline(vertices).ToPolylineCurve();
    }

    private static Color MaterialColor(DisplayBatch batch, int materialId)
    {
        if (batch.Materials != null && materialId >= 0 && materialId < batch.Materials.Count)
        {
            var hex = batch.Materials[materialId]?.Color;
            if (!string.IsNullOrEmpty(hex))
            {
                return ColorTranslator.FromHtml(hex);
            }
        }

        return Color.Gray;
    }
}
