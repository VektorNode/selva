using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     Reads and writes the SLVM v3 container — the chunked format that carries a whole
///     <see cref="DisplayBatch" /> as one self-describing byte stream. The same bytes serve as the
///     wire blob (<see cref="DisplayBatch.CompressedData" />) and, with the item chunks added, as
///     the <c>.slvm</c> file; there is no separate on-disk container.
///
///     Wire format (little-endian):
///
///     [4]  magic      = "SLVM" (0x53 0x4C 0x56 0x4D)
///     [4]  version    = uint32 (currently 3; v1 was the DMF1 container, v2 the pre-release
///                       layout with an originalIndex table column — both retired)
///     [4]  chunkCount = uint32
///     then chunkCount chunks, each:
///     [4]  type       = fourcc
///     [4]  byteLen    = uint32 payload length (unpadded)
///     [N]  payload
///     [P]  zero pad to the next 4-byte boundary
///
///     Readers skip chunks whose type they don't know — that is the format's extension mechanism.
///     Each type appears at most once, except TEXR which repeats (its ordinal is the texture index).
///
///     Chunk types:
///
///     GEOM  mesh geometry. Payload is a complete SLVA/SLVZ blob (see SlvaWriter) whose
///           embedded metadata JSON is empty — the object table lives in TABL, not in the blob.
///     CRVS  polyline vertices for curve objects, concatenated in object order. Payload is again a
///           bare SLVA/SLVZ blob with indexCount = 0; per-curve point counts live in TABL.
///     PNTS  point positions for point objects, same encoding as CRVS.
///     TABL  the object table (see <see cref="SlvmTable" /> for the byte layout). Optionally
///           SLVZ-wrapped.
///     MATL  UTF-8 JSON {"materials":[...]}. A material's "map" may be "slvm:tex:N", which readers
///           resolve against the Nth TEXR chunk.
///     TEXR  one texture: [varint mimeLen][mime utf8][image bytes].
///     EXTN  host extension: [varint nsLen][namespace utf8][payload]. Foreign readers skip it.
///           Selva writes namespace "selva.gh" (see <see cref="SelvaExtension" />) with a JSON
///           payload {"curves": {"objIndex": "rhino nurbs json", ...}} — only when the batch
///           actually carries curves; a mesh-only container has no EXTN at all.
///
///     Object model: one global index space, meshes first, then curves, then points. TABL stores
///     per-object counts; vertex/index windows are the prefix sums of those counts in table order —
///     the geometry streams MUST be concatenated in table order, so starts are never stored and
///     windows cannot overlap or overrun by construction.
/// </summary>
public static class SlvmDocument
{
    public const uint Magic = 0x4D564C53; // "SLVM" little-endian
    public const uint Version = 3;

    public const uint ChunkGeom = 0x4D4F4547; // "GEOM"
    public const uint ChunkCrvs = 0x53565243; // "CRVS"
    public const uint ChunkPnts = 0x53544E50; // "PNTS"
    public const uint ChunkTabl = 0x4C424154; // "TABL"
    public const uint ChunkMatl = 0x4C54414D; // "MATL"
    public const uint ChunkTexr = 0x52584554; // "TEXR"
    public const uint ChunkExtn = 0x4E545845; // "EXTN"

    public const string SelvaGhNamespace = "selva.gh";

    /// <summary>Material "map" prefix that references a TEXR chunk by index.</summary>
    public const string TexRefPrefix = "slvm:tex:";

    /// <summary>
    ///     Reserved attr key carrying each object's identity (<see cref="MeshMetadata.Id" />) —
    ///     same mechanism as user metadata, split back out on read.
    /// </summary>
    public const string IdKey = "id";

    /// <summary>Reserved attr keys for curve/point styling — same mechanism as user metadata.</summary>
    public const string StyleColorKey = "style:color";
    public const string StyleOpacityKey = "style:opacity";

    public static bool IsSlvm(byte[] bytes)
    {
        return bytes != null && bytes.Length >= 4 && BitConverter.ToUInt32(bytes, 0) == Magic;
    }

    // ============================================================================
    // WRITE
    // ============================================================================

    /// <summary>
    ///     Serializes a batch into an SLVM container. <paramref name="geometryBlob" /> is the
    ///     already-encoded SLVA/SLVZ mesh blob (empty metadata); pass the batch's item list through
    ///     <paramref name="includeItems" /> only for files — the wire sends items as JSON alongside.
    ///     <paramref name="extensions" /> adds one EXTN chunk per entry (namespace → payload bytes)
    ///     for hosts other than selva.gh, whose extension is composed from the batch itself.
    /// </summary>
    public static byte[] Write(DisplayBatch batch, byte[] geometryBlob, bool includeItems,
        IReadOnlyDictionary<string, byte[]> extensions = null)
    {
        if (batch == null)
        {
            throw new ArgumentNullException(nameof(batch));
        }

        var meshes = batch.Groups?.SelectMany(g => g.Meshes ?? new List<MeshMetadata>()).ToList()
                     ?? new List<MeshMetadata>();
        var items = includeItems && batch.Items != null ? batch.Items.Where(i => i != null).ToList()
            : new List<DisplayItem>();
        var curves = items.Where(i => i.Kind == "curve").ToList();
        var points = items.Where(i => i.Kind == "point" && i.Position != null).ToList();

        var chunks = new List<(uint type, byte[] payload)>();

        chunks.Add((ChunkGeom, geometryBlob ?? EmptyGeometryBlob()));

        if (curves.Count > 0)
        {
            chunks.Add((ChunkCrvs, EncodePolylineBlob(curves.Select(c => c.Points))));
        }

        if (points.Count > 0)
        {
            chunks.Add((ChunkPnts, EncodePointBlob(points)));
        }

        chunks.Add((ChunkTabl, SlvzCompressor.Compress(SlvmTable.Write(batch, meshes, curves, points))));

        var (materialsJson, textures) = ExtractTextures(batch.Materials);
        chunks.Add((ChunkMatl, Encoding.UTF8.GetBytes(materialsJson)));
        foreach (var tex in textures)
        {
            chunks.Add((ChunkTexr, tex));
        }

        // EXTN chunks last by writer convention.
        var ext = SelvaExtension.Build(curves, meshes.Count);
        if (ext != null)
        {
            chunks.Add((ChunkExtn, ext));
        }

        if (extensions != null)
        {
            foreach (var kv in extensions)
            {
                if (kv.Key == SelvaGhNamespace)
                {
                    throw new ArgumentException(
                        $"The \"{SelvaGhNamespace}\" extension is composed from the batch itself.",
                        nameof(extensions));
                }

                chunks.Add((ChunkExtn, ExtensionChunk.Encode(kv.Key, kv.Value ?? Array.Empty<byte>())));
            }
        }

        return SlvmChunks.Write(chunks);
    }

    /// <summary>Chunk-level copy with the geometry payload swapped — metadata survives byte-exact.</summary>
    public static byte[] ReplaceGeometry(byte[] slvm, byte[] newGeometryBlob)
    {
        var chunks = SlvmChunks.Read(slvm);
        for (var i = 0; i < chunks.Count; i++)
        {
            if (chunks[i].type == ChunkGeom)
            {
                chunks[i] = (ChunkGeom, newGeometryBlob);
            }
        }

        return SlvmChunks.Write(chunks);
    }

    /// <summary>
    ///     File → wire: drops the items (CRVS/PNTS, their table rows, the curve JSON in EXTN).
    ///     Not chunk surgery — the table declares the item rows, so it must be rebuilt with them
    ///     gone or a reader would index geometry that isn't there. The mesh blob is untouched.
    /// </summary>
    public static byte[] StripItems(byte[] slvm)
    {
        var doc = Read(slvm);
        doc.Batch.Items = null;
        return Write(doc.Batch, doc.GeometryBlob, includeItems: false, doc.Extensions);
    }

    // ============================================================================
    // READ
    // ============================================================================

    public sealed class ReadResult
    {
        /// <summary>The reconstructed batch. Items are present only when the container has item chunks.</summary>
        public DisplayBatch Batch { get; set; }

        /// <summary>The GEOM payload: an SLVA/SLVZ blob with empty metadata.</summary>
        public byte[] GeometryBlob { get; set; }

        /// <summary>
        ///     EXTN payloads from hosts other than selva.gh, namespace → payload bytes. Null when
        ///     none. Pass back into <see cref="Write" /> to survive a rebuild.
        /// </summary>
        public Dictionary<string, byte[]> Extensions { get; set; }
    }

    public static ReadResult Read(byte[] bytes)
    {
        var chunks = SlvmChunks.Read(bytes);

        byte[] geometryBlob = null;
        byte[] crvsBlob = null;
        byte[] pntsBlob = null;
        byte[] tableBytes = null;
        string materialsJson = null;
        var textures = new List<byte[]>();
        Dictionary<string, byte[]> extensions = null;
        foreach (var (type, payload) in chunks)
        {
            switch (type)
            {
                case ChunkGeom: geometryBlob = payload; break;
                case ChunkCrvs: crvsBlob = payload; break;
                case ChunkPnts: pntsBlob = payload; break;
                case ChunkTabl: tableBytes = SlvzCompressor.MaybeDecompress(payload); break;
                case ChunkMatl: materialsJson = Encoding.UTF8.GetString(payload); break;
                case ChunkTexr: textures.Add(payload); break;
                case ChunkExtn:
                    // selva.gh is decoded below; foreign namespaces surface as opaque payloads.
                    var (ns, body) = ExtensionChunk.Decode(payload);
                    if (ns != SelvaGhNamespace)
                    {
                        (extensions ??= new Dictionary<string, byte[]>())[ns] = body;
                    }

                    break;
                // Unknown chunks are skipped: that's the extension model.
            }
        }

        if (tableBytes == null)
        {
            throw new InvalidDataException("SLVM container has no TABL chunk.");
        }

        var table = SlvmTable.Read(tableBytes);
        var ext = SelvaExtension.Read(chunks);

        var batch = new DisplayBatch
        {
            Materials = ParseMaterials(materialsJson, textures),
            Groups = BuildGroups(table)
        };

        if (table.CurveCount > 0 || table.PointCount > 0)
        {
            batch.Items = BuildItems(table, crvsBlob, pntsBlob, ext);
        }

        return new ReadResult
        {
            Batch = batch,
            GeometryBlob = geometryBlob ?? EmptyGeometryBlob(),
            Extensions = extensions
        };
    }

    // ============================================================================
    // BATCH RECONSTRUCTION
    // ============================================================================

    private static List<MaterialGroup> BuildGroups(SlvmTable.Table t)
    {
        var groups = new List<MaterialGroup>();
        var meshIndex = 0;
        var vertexStart = 0;
        var indexStart = 0;

        // A table with meshes but no runs (foreign writer) gets one implicit group on material 0.
        var runs = t.MaterialRuns.Count > 0 || t.MeshCount == 0
            ? t.MaterialRuns
            : new List<(int, int)> { (0, t.MeshCount) };

        foreach (var (materialId, count) in runs)
        {
            var group = new MaterialGroup { MaterialId = materialId, Meshes = new List<MeshMetadata>(count) };
            for (var i = 0; i < count && meshIndex < t.MeshCount; i++, meshIndex++)
            {
                var attrs = t.Attrs[meshIndex];
                group.Meshes.Add(new MeshMetadata
                {
                    Id = t.Ids[meshIndex],
                    Name = t.Names[meshIndex],
                    Layer = t.Layers[meshIndex],
                    VertexCount = t.MeshVertexCounts[meshIndex],
                    IndexCount = t.MeshTriCounts[meshIndex] * 3,
                    VertexStart = vertexStart,
                    IndexStart = indexStart,
                    Metadata = attrs
                });
                vertexStart += t.MeshVertexCounts[meshIndex];
                indexStart += t.MeshTriCounts[meshIndex] * 3;
            }

            groups.Add(group);
        }

        return groups;
    }

    private static List<DisplayItem> BuildItems(
        SlvmTable.Table t, byte[] crvsBlob, byte[] pntsBlob, SelvaExtension ext)
    {
        var items = new List<DisplayItem>(t.CurveCount + t.PointCount);
        var curveVerts = crvsBlob != null ? SlvaReader.Read(crvsBlob).Vertices : Array.Empty<float>();
        var pointVerts = pntsBlob != null ? SlvaReader.Read(pntsBlob).Vertices : Array.Empty<float>();

        var component = 0;
        for (var c = 0; c < t.CurveCount; c++)
        {
            var objIndex = t.MeshCount + c;
            var n = t.CurvePointCounts[c];
            var pts = new double[n * 3];
            for (var i = 0; i < n * 3; i++)
            {
                pts[i] = curveVerts[component + i];
            }

            component += n * 3;

            string json = null;
            ext?.Curves?.TryGetValue(objIndex.ToString(System.Globalization.CultureInfo.InvariantCulture), out json);

            var (attrs, color, opacity) = SplitStyle(t.Attrs[objIndex]);
            items.Add(new DisplayItem
            {
                Kind = "curve",
                Json = json,
                Points = pts,
                Id = t.Ids[objIndex],
                Name = t.Names[objIndex],
                Layer = t.Layers[objIndex],
                Metadata = attrs,
                Color = color,
                Opacity = opacity
            });
        }

        for (var p = 0; p < t.PointCount; p++)
        {
            var objIndex = t.MeshCount + t.CurveCount + p;
            var (attrs, color, opacity) = SplitStyle(t.Attrs[objIndex]);
            items.Add(new DisplayItem
            {
                Kind = "point",
                Position = new DisplayPosition
                {
                    X = pointVerts[p * 3],
                    Y = pointVerts[p * 3 + 1],
                    Z = pointVerts[p * 3 + 2]
                },
                Id = t.Ids[objIndex],
                Name = t.Names[objIndex],
                Layer = t.Layers[objIndex],
                Metadata = attrs,
                Color = color,
                Opacity = opacity
            });
        }

        return items;
    }

    private static (Dictionary<string, string> attrs, string color, double? opacity) SplitStyle(
        Dictionary<string, string> attrs)
    {
        if (attrs == null)
        {
            return (null, null, null);
        }

        string color = null;
        double? opacity = null;
        var rest = new Dictionary<string, string>();
        foreach (var kv in attrs)
        {
            if (kv.Key == StyleColorKey)
            {
                color = kv.Value;
            }
            else if (kv.Key == StyleOpacityKey)
            {
                if (double.TryParse(kv.Value, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out var o))
                {
                    opacity = o;
                }
            }
            else
            {
                rest[kv.Key] = kv.Value;
            }
        }

        return (rest.Count > 0 ? rest : null, color, opacity);
    }

    // ============================================================================
    // ITEM GEOMETRY
    // ============================================================================

    private static byte[] EncodePolylineBlob(IEnumerable<double[]> pointArrays)
    {
        var all = new List<float>();
        foreach (var pts in pointArrays)
        {
            if (pts == null)
            {
                continue;
            }

            foreach (var v in pts)
            {
                all.Add((float)v);
            }
        }

        return EncodeVertexOnlyBlob(all.ToArray());
    }

    private static byte[] EncodePointBlob(List<DisplayItem> points)
    {
        var all = new float[points.Count * 3];
        for (var i = 0; i < points.Count; i++)
        {
            all[i * 3] = (float)points[i].Position.X;
            all[i * 3 + 1] = (float)points[i].Position.Y;
            all[i * 3 + 2] = (float)points[i].Position.Z;
        }

        return EncodeVertexOnlyBlob(all);
    }

    /// <summary>
    ///     A vertex stream with no indices is still a valid SLVA blob, so polylines and points
    ///     reuse the mesh codec (quantize + delta + planar probe + SLVZ) unchanged.
    /// </summary>
    private static byte[] EncodeVertexOnlyBlob(float[] vertices)
    {
        using (var ms = new MemoryStream())
        {
            SlvaWriter.Write(ms, "", vertices, Array.Empty<int>());
            return SlvzCompressor.Compress(ms.GetBuffer(), (int)ms.Length);
        }
    }

    private static byte[] EmptyGeometryBlob()
    {
        using (var ms = new MemoryStream())
        {
            SlvaWriter.Write(ms, "", Array.Empty<float>(), Array.Empty<int>());
            return ms.ToArray();
        }
    }

    // ============================================================================
    // MATERIALS + TEXTURES
    // ============================================================================

    private static (string json, List<byte[]> textures) ExtractTextures(List<SerializableMaterial> materials)
    {
        var textures = new List<byte[]>();
        var outMaterials = new List<SerializableMaterial>();
        foreach (var m in materials ?? new List<SerializableMaterial>())
        {
            var map = m.Map;
            if (map != null && map.StartsWith("data:", StringComparison.Ordinal))
            {
                var tex = TryParseDataUri(map);
                if (tex != null)
                {
                    map = TexRefPrefix + textures.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    textures.Add(tex);
                }
            }

            outMaterials.Add(new SerializableMaterial
            {
                Color = m.Color,
                Metalness = m.Metalness,
                Roughness = m.Roughness,
                Opacity = m.Opacity,
                Transparent = m.Transparent,
                Map = map
            });
        }

        var json = JsonConvert.SerializeObject(new { materials = outMaterials });
        return (json, textures);
    }

    /// <summary>"data:mime;base64,..." → [varint mimeLen][mime][raw bytes], or null if unparseable.</summary>
    private static byte[] TryParseDataUri(string uri)
    {
        var comma = uri.IndexOf(',');
        var header = comma > 0 ? uri.Substring(5, comma - 5) : null;
        if (header == null || !header.EndsWith(";base64", StringComparison.Ordinal))
        {
            return null;
        }

        var mime = header.Substring(0, header.Length - ";base64".Length);
        byte[] data;
        try
        {
            data = Convert.FromBase64String(uri.Substring(comma + 1));
        }
        catch (FormatException)
        {
            return null;
        }

        var mimeBytes = Encoding.UTF8.GetBytes(mime);
        using (var ms = new MemoryStream())
        {
            Varint.Write(ms, (uint)mimeBytes.Length);
            ms.Write(mimeBytes, 0, mimeBytes.Length);
            ms.Write(data, 0, data.Length);
            return ms.ToArray();
        }
    }

    private sealed class MaterialsEnvelope
    {
        [JsonProperty("materials")] public List<SerializableMaterial> Materials { get; set; }
    }

    private static List<SerializableMaterial> ParseMaterials(string json, List<byte[]> textures)
    {
        var materials = json != null
            ? JsonConvert.DeserializeObject<MaterialsEnvelope>(json)?.Materials
            : null;
        materials ??= new List<SerializableMaterial>();

        foreach (var m in materials)
        {
            if (m.Map != null && m.Map.StartsWith(TexRefPrefix, StringComparison.Ordinal)
                && int.TryParse(m.Map.Substring(TexRefPrefix.Length), out var texIndex)
                && texIndex >= 0 && texIndex < textures.Count)
            {
                var tex = textures[texIndex];
                var pos = 0;
                var mimeLen = (int)Varint.Read(tex, ref pos);
                var mime = Encoding.UTF8.GetString(tex, pos, mimeLen);
                pos += mimeLen;
                m.Map = "data:" + mime + ";base64," + Convert.ToBase64String(tex, pos, tex.Length - pos);
            }
        }

        return materials;
    }
}
