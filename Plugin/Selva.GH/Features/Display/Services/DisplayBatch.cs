using System.Collections.Generic;
using System.Drawing;
using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     One Display component's payload, ready for Three.js rendering. Meshes travel as a binary
///     blob (<see cref="CompressedData" />); non-mesh display items (curves, points, later
///     labels/icons) ride as JSON in <see cref="Items" />. Named <c>DisplayBatch</c> rather than
///     <c>MeshBatch</c> because it carries more than meshes.
/// </summary>
public class DisplayBatch
{
    [JsonProperty("materials")]
    public List<SerializableMaterial> Materials { get; set; }

    [JsonProperty("groups")]
    public List<MaterialGroup> Groups { get; set; }

    /// <summary>
    ///     The batch's binary payload: an SLVM v2 container (<see cref="SlvmDocument" />) holding
    ///     the geometry blob plus the object table/materials as chunks. Old `.gh` files still hold
    ///     bare SLVA/SLVZ blobs here; readers dispatch on the leading magic. Travels as base64
    ///     inside the values JSON, or raw over the WebSocket's binary frames. Field name is
    ///     preserved for `.gh` backward compatibility.
    ///
    ///     Always present and non-null, even for an items-only batch: the writer emits a valid
    ///     empty blob (vertexCount = 0), so neither side needs an "is the blob present?" branch —
    ///     the mesh parser just produces zero meshes from an empty blob.
    /// </summary>
    [JsonProperty("compressedData")]
    public byte[] CompressedData { get; set; }

    /// <summary>
    ///     The batch's identity namespace: one id per batch, which together with a mesh's
    ///     <see cref="MeshMetadata.OriginalIndex" /> gives the web a key that survives a solve
    ///     (hidden state, selection, per-object overrides all hang off it).
    ///
    ///     Usually the producing Display component's InstanceGuid — stable across solves, which is
    ///     what makes the key stable. It is NOT always a component: a combined batch takes the
    ///     combiner's own id, since the sources it merged can no longer own one key space between
    ///     them. Which component actually produced a mesh is recorded per mesh instead, in the
    ///     <c>gh:component</c> metadata attr.
    ///
    ///     The JSON name stays <c>batchId</c>: it is the wire contract with published
    ///     `@selvajs/*` releases, and it is baked into every pre-v2 blob, `.gh` archive and
    ///     `.slvm` file on disk.
    /// </summary>
    [JsonProperty("sourceComponentId")]
    public string BatchId { get; set; }

    /// <summary>
    ///     Non-mesh display items. Omitted from the JSON when empty so mesh-only batches stay
    ///     byte-for-byte as before. Unlike meshes these don't go through
    ///     <see cref="MeshBatchAssembler" /> — the component sets this directly.
    /// </summary>
    [JsonProperty("items", NullValueHandling = NullValueHandling.Ignore)]
    public List<DisplayItem> Items { get; set; }
}

/// <summary>A group of meshes sharing the same material, so Three.js can merge them into one BufferGeometry.</summary>
public class MaterialGroup
{
    [JsonProperty("materialId")]
    public int MaterialId { get; set; }

    [JsonProperty("meshes")]
    public List<MeshMetadata> Meshes { get; set; }
}

public class MeshMetadata
{
    [JsonProperty("name")] public string Name { get; set; }

    /// <summary>Layer path for grouping in the scene manager (e.g. "Structure/Walls").</summary>
    [JsonProperty("layer")]
    public string Layer { get; set; }

    /// <summary>
    ///     Index of this mesh in the GH input tree, before material grouping. Together with
    ///     <see cref="DisplayBatch.BatchId" />, uniquely identifies the GH source.
    /// </summary>
    [JsonProperty("originalIndex")]
    public int OriginalIndex { get; set; }

    [JsonProperty("vertexCount")]
    public int VertexCount { get; set; }

    /// <summary>3 per triangle.</summary>
    [JsonProperty("indexCount")]
    public int IndexCount { get; set; }

    /// <summary>
    ///     First vertex of this mesh in the combined vertex array, in vertex-count units — the
    ///     component offset into the int16/float32 typed array is <c>VertexStart * 3</c>.
    /// </summary>
    [JsonProperty("vertexStart")]
    public int VertexStart { get; set; }

    [JsonProperty("indexStart")]
    public int IndexStart { get; set; }

    [JsonProperty("metadata")] public Dictionary<string, string> Metadata { get; set; }
}

/// <summary>Serializable material: same shape as <see cref="ThreeMaterial"/> but with Color as a hex string.</summary>
public class SerializableMaterial
{
    [JsonProperty("color")] public string Color { get; set; }

    [JsonProperty("metalness")] public double Metalness { get; set; }

    [JsonProperty("roughness")] public double Roughness { get; set; }

    [JsonProperty("opacity")] public double Opacity { get; set; }

    [JsonProperty("transparent")] public bool Transparent { get; set; }

    /// <summary>Texture URL/data URI; omitted from JSON when null.</summary>
    [JsonProperty("map", NullValueHandling = NullValueHandling.Ignore)]
    public string Map { get; set; }

    public static SerializableMaterial FromThreeMaterial(ThreeMaterial material)
    {
        return new SerializableMaterial
        {
            Color = ColorTranslator.ToHtml(material.Color),
            Metalness = material.Metalness,
            Roughness = material.Roughness,
            Opacity = material.Opacity,
            Transparent = material.Transparent,
            Map = string.IsNullOrEmpty(material.Map) ? null : material.Map
        };
    }

    /// <summary>
    ///     Back to the canvas-side type, so a decoded batch can be fed to
    ///     <see cref="MeshBatchAssembler.CreateBatch" /> — which dedupes on
    ///     <see cref="ThreeMaterial" />, not on this. An unparseable color falls back to white
    ///     rather than throwing: a bad swatch should not fail a whole combine.
    /// </summary>
    public ThreeMaterial ToThreeMaterial()
    {
        Color color;
        try
        {
            color = string.IsNullOrEmpty(Color) ? System.Drawing.Color.White : ColorTranslator.FromHtml(Color);
        }
        catch (System.Exception)
        {
            color = System.Drawing.Color.White;
        }

        return new ThreeMaterial
        {
            Color = color,
            Metalness = Metalness,
            Roughness = Roughness,
            Opacity = Opacity,
            Transparent = Transparent,
            Map = Map
        };
    }
}
