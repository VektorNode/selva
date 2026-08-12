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
    ///     Binary geometry blob written by <see cref="BinaryGeometryWriter" />: magic header,
    ///     metadata JSON, quantized int16 (or float32) vertices, and uint32 indices. Travels as
    ///     base64 inside the values JSON for now. Field name is preserved for `.gh` backward
    ///     compatibility.
    ///
    ///     Always present and non-null, even for an items-only batch: the writer emits a valid
    ///     empty blob (vertexCount = 0), so neither side needs an "is the blob present?" branch —
    ///     the mesh parser just produces zero meshes from an empty blob.
    /// </summary>
    [JsonProperty("compressedData")]
    public byte[] CompressedData { get; set; }

    /// <summary>InstanceGuid of the WebDisplay component that produced this batch.</summary>
    [JsonProperty("sourceComponentId")]
    public string SourceComponentId { get; set; }

    /// <summary>
    ///     Non-mesh display items. Omitted from the JSON when empty so mesh-only batches stay
    ///     byte-for-byte as before. Unlike meshes these don't go through
    ///     <see cref="MeshBatchProcessor" /> — the component sets this directly.
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
    ///     <see cref="DisplayBatch.SourceComponentId" />, uniquely identifies the GH source.
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
}
