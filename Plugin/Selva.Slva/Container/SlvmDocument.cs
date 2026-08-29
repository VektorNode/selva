using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     Reads and writes the SLVM v2 container — the chunked format that carries a whole
///     <see cref="DisplayBatch" /> as one self-describing byte stream. The same bytes serve as the
///     wire blob (<see cref="DisplayBatch.CompressedData" />) and, with the item chunks added, as
///     the <c>.slvm</c> file; there is no separate on-disk container.
///
///     Wire format (little-endian):
///
///     [4]  magic      = "SLVM" (0x53 0x4C 0x56 0x4D)
///     [4]  version    = uint32 (currently 2; v1 was the DMF1 container, retired)
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
///     TABL  the object table (see WriteTable for the byte layout). Optionally SLVZ-wrapped.
///     MATL  UTF-8 JSON {"materials":[...]}. A material's "map" may be "slvm:tex:N", which readers
///           resolve against the Nth TEXR chunk.
///     TEXR  one texture: [varint mimeLen][mime utf8][image bytes].
///     EXTN  host extension: [varint nsLen][namespace utf8][payload]. Foreign readers skip it.
///           Selva writes namespace "selva.gh" with a JSON payload:
///           {"batchId": "...", "curves": {"objIndex": "rhino nurbs json", ...}}.
///           "sourceComponentId" is still accepted as a read-only alias for batchId.
///
///     Object model: one global index space, meshes first, then curves, then points. TABL stores
///     per-object counts; vertex/index windows are the prefix sums of those counts in table order —
///     the geometry streams MUST be concatenated in table order, so starts are never stored and
///     windows cannot overlap or overrun by construction.
/// </summary>
public static class SlvmDocument
{
    public const uint Magic = 0x4D564C53; // "SLVM" little-endian
    public const uint Version = 2;

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

    // Name column modes. Sequential covers the default auto-numbering ("1".."n") at zero bytes.
    private const byte NamesNone = 0;
    private const byte NamesSequential = 1;
    private const byte NamesPool = 2;

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
    /// </summary>
    public static byte[] Write(DisplayBatch batch, byte[] geometryBlob, bool includeItems)
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

        chunks.Add((ChunkTabl, SlvzCompressor.Compress(WriteTable(batch, meshes, curves, points))));

        var (materialsJson, textures) = ExtractTextures(batch.Materials);
        chunks.Add((ChunkMatl, Encoding.UTF8.GetBytes(materialsJson)));
        foreach (var tex in textures)
        {
            chunks.Add((ChunkTexr, tex));
        }

        // EXTN last by writer convention, so a restamp rewrites only the tail of the stream.
        var ext = BuildSelvaExtension(batch.BatchId, curves, meshes.Count);
        if (ext != null)
        {
            chunks.Add((ChunkExtn, ext));
        }

        return WriteChunks(chunks);
    }

    /// <summary>Chunk-level copy with the geometry payload swapped — metadata survives byte-exact.</summary>
    public static byte[] ReplaceGeometry(byte[] slvm, byte[] newGeometryBlob)
    {
        var chunks = ReadChunks(slvm);
        for (var i = 0; i < chunks.Count; i++)
        {
            if (chunks[i].type == ChunkGeom)
            {
                chunks[i] = (ChunkGeom, newGeometryBlob);
            }
        }

        return WriteChunks(chunks);
    }

    /// <summary>
    ///     File → wire: drops the items (CRVS/PNTS, their table rows, the curve JSON in EXTN).
    ///     Not chunk surgery — the table declares the item rows, so it must be rebuilt with them
    ///     gone or a reader would index geometry that isn't there. The mesh blob is untouched.
    /// </summary>
    public static byte[] StripItems(byte[] slvm, string batchId)
    {
        var doc = Read(slvm);
        doc.Batch.Items = null;
        doc.Batch.BatchId = batchId;
        return Write(doc.Batch, doc.GeometryBlob, includeItems: false);
    }

    /// <summary>
    ///     Rewrites the selva.gh extension with a new source component id, leaving every other
    ///     chunk untouched. This is how Display From File gives each loader instance its own web
    ///     pick identity without re-encoding any geometry.
    /// </summary>
    public static byte[] Restamp(byte[] slvm, string newSourceComponentId)
    {
        var chunks = ReadChunks(slvm);
        var curvesJson = ReadSelvaExtension(chunks)?.Curves;
        chunks.RemoveAll(c => c.type == ChunkExtn);
        var ext = BuildSelvaExtension(newSourceComponentId, curvesJson);
        if (ext != null)
        {
            chunks.Add((ChunkExtn, ext));
        }

        return WriteChunks(chunks);
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
    }

    public static ReadResult Read(byte[] bytes)
    {
        var chunks = ReadChunks(bytes);

        byte[] geometryBlob = null;
        byte[] crvsBlob = null;
        byte[] pntsBlob = null;
        byte[] tableBytes = null;
        string materialsJson = null;
        var textures = new List<byte[]>();
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
                // Unknown chunks (and EXTN, handled below) are skipped: that's the extension model.
            }
        }

        if (tableBytes == null)
        {
            throw new InvalidDataException("SLVM container has no TABL chunk.");
        }

        var table = ReadTable(tableBytes);
        var ext = ReadSelvaExtension(chunks);

        var batch = new DisplayBatch
        {
            Materials = ParseMaterials(materialsJson, textures),
            Groups = BuildGroups(table),
            BatchId = ext?.BatchId ?? ext?.LegacyBatchId
        };

        if (table.CurveCount > 0 || table.PointCount > 0)
        {
            batch.Items = BuildItems(table, crvsBlob, pntsBlob, ext, batch.BatchId);
        }

        return new ReadResult { Batch = batch, GeometryBlob = geometryBlob ?? EmptyGeometryBlob() };
    }

    // ============================================================================
    // CHUNK STREAM
    // ============================================================================

    private static byte[] WriteChunks(List<(uint type, byte[] payload)> chunks)
    {
        using (var ms = new MemoryStream())
        using (var w = new BinaryWriter(ms))
        {
            w.Write(Magic);
            w.Write(Version);
            w.Write((uint)chunks.Count);
            foreach (var (type, payload) in chunks)
            {
                var body = payload ?? Array.Empty<byte>();
                w.Write(type);
                w.Write((uint)body.Length);
                w.Write(body);
                for (var pad = (4 - body.Length % 4) % 4; pad > 0; pad--)
                {
                    w.Write((byte)0);
                }
            }

            return ms.ToArray();
        }
    }

    private static List<(uint type, byte[] payload)> ReadChunks(byte[] bytes)
    {
        if (bytes == null || bytes.Length < 12 || BitConverter.ToUInt32(bytes, 0) != Magic)
        {
            throw new InvalidDataException("Not an SLVM container (bad magic).");
        }

        var version = BitConverter.ToUInt32(bytes, 4);
        if (version != Version)
        {
            throw new InvalidDataException($"Unsupported SLVM version {version} (expected {Version}).");
        }

        var count = BitConverter.ToUInt32(bytes, 8);
        var chunks = new List<(uint, byte[])>((int)count);
        var offset = 12;
        for (var i = 0; i < count; i++)
        {
            if (offset + 8 > bytes.Length)
            {
                throw new InvalidDataException("Truncated SLVM chunk header.");
            }

            var type = BitConverter.ToUInt32(bytes, offset);
            var len = (int)BitConverter.ToUInt32(bytes, offset + 4);
            offset += 8;
            if (offset + len > bytes.Length)
            {
                throw new InvalidDataException("Truncated SLVM chunk payload.");
            }

            var payload = new byte[len];
            Buffer.BlockCopy(bytes, offset, payload, 0, len);
            chunks.Add((type, payload));
            offset += len + (4 - len % 4) % 4;
        }

        return chunks;
    }

    // ============================================================================
    // TABL
    // ============================================================================

    /// <summary>
    ///     The object table. Byte layout, in order (all varints are unsigned LEB128):
    ///
    ///     [varint] meshCount, curveCount, pointCount
    ///     string pool: [varint stringCount], per string [varint byteLen][utf8]
    ///     per mesh:   [varint vertexCount][varint triangleCount]
    ///     per curve:  [varint pointCount]
    ///     (points are one point per object — no counts)
    ///     material runs (meshes only, in table order): [varint runCount],
    ///                 per run [varint materialId][varint meshCount]
    ///     originalIndex column: [u8 present]; if 1, [varint] per object.
    ///                 Absent means identity — but the assembler sorts meshes by material, so any
    ///                 multi-material batch needs the column.
    ///     names column:  [u8 mode] 0 = all empty, 1 = sequential "1".."n" over the global object
    ///                 index (the auto-numbering default), 2 = [varint poolRef] per object.
    ///     layers column: [u8 mode] 0 = all empty, 2 = [varint poolRef] per object.
    ///     attrs: [varint attrCount], per attr [varint keyPoolRef][varint n]
    ///                 n × [varint objIndexDelta] (strictly increasing, delta from previous)
    ///                 n × [varint valuePoolRef]
    ///
    ///     Attr keys are namespaced by convention ("gh:branch", "ifc:guid", "style:color"); the
    ///     table mechanism itself knows nothing about any namespace.
    /// </summary>
    private static byte[] WriteTable(
        DisplayBatch batch, List<MeshMetadata> meshes, List<DisplayItem> curves, List<DisplayItem> points)
    {
        var objects = new List<(string name, string layer, int originalIndex, Dictionary<string, string> attrs)>();
        foreach (var m in meshes)
        {
            objects.Add((m.Name, m.Layer, m.OriginalIndex, m.Metadata));
        }

        foreach (var item in curves.Concat(points))
        {
            var attrs = item.Metadata != null
                ? new Dictionary<string, string>(item.Metadata)
                : new Dictionary<string, string>();
            if (item.Color != null)
            {
                attrs[StyleColorKey] = item.Color;
            }

            if (item.Opacity.HasValue)
            {
                attrs[StyleOpacityKey] = item.Opacity.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }

            objects.Add((item.Name, item.Layer, ParseItemOrdinal(item.Id), attrs.Count > 0 ? attrs : null));
        }

        var pool = new StringPool();
        using (var ms = new MemoryStream())
        {
            // Columns are written to a scratch stream first so the pool, referenced by index, can
            // be emitted before them in one pass.
            byte[] columns;
            using (var cs = new MemoryStream())
            {
                foreach (var m in meshes)
                {
                    WriteVarint(cs, (uint)m.VertexCount);
                    WriteVarint(cs, (uint)(m.IndexCount / 3));
                }

                foreach (var c in curves)
                {
                    WriteVarint(cs, (uint)((c.Points?.Length ?? 0) / 3));
                }

                WriteMaterialRuns(cs, batch);
                WriteOriginalIndexColumn(cs, objects);
                WriteStringColumn(cs, objects.Select(o => o.name).ToList(), pool, allowSequential: true);
                WriteStringColumn(cs, objects.Select(o => o.layer).ToList(), pool, allowSequential: false);
                WriteAttrColumns(cs, objects, pool);
                columns = cs.ToArray();
            }

            WriteVarint(ms, (uint)meshes.Count);
            WriteVarint(ms, (uint)curves.Count);
            WriteVarint(ms, (uint)points.Count);
            pool.WriteTo(ms);
            ms.Write(columns, 0, columns.Length);
            return ms.ToArray();
        }
    }

    private sealed class Table
    {
        public int MeshCount, CurveCount, PointCount;
        public int[] MeshVertexCounts, MeshTriCounts, CurvePointCounts;
        public List<(int materialId, int meshCount)> MaterialRuns;
        public int[] OriginalIndices; // null = identity
        public string[] Names, Layers;
        public Dictionary<string, string>[] Attrs; // per object, null when none
    }

    private static Table ReadTable(byte[] bytes)
    {
        var pos = 0;
        var t = new Table
        {
            MeshCount = (int)ReadVarint(bytes, ref pos),
            CurveCount = (int)ReadVarint(bytes, ref pos),
            PointCount = (int)ReadVarint(bytes, ref pos)
        };
        var objectCount = t.MeshCount + t.CurveCount + t.PointCount;

        var poolCount = (int)ReadVarint(bytes, ref pos);
        var pool = new string[poolCount];
        for (var i = 0; i < poolCount; i++)
        {
            var len = (int)ReadVarint(bytes, ref pos);
            pool[i] = Encoding.UTF8.GetString(bytes, pos, len);
            pos += len;
        }

        t.MeshVertexCounts = new int[t.MeshCount];
        t.MeshTriCounts = new int[t.MeshCount];
        for (var i = 0; i < t.MeshCount; i++)
        {
            t.MeshVertexCounts[i] = (int)ReadVarint(bytes, ref pos);
            t.MeshTriCounts[i] = (int)ReadVarint(bytes, ref pos);
        }

        t.CurvePointCounts = new int[t.CurveCount];
        for (var i = 0; i < t.CurveCount; i++)
        {
            t.CurvePointCounts[i] = (int)ReadVarint(bytes, ref pos);
        }

        var runCount = (int)ReadVarint(bytes, ref pos);
        t.MaterialRuns = new List<(int, int)>(runCount);
        for (var i = 0; i < runCount; i++)
        {
            var id = (int)ReadVarint(bytes, ref pos);
            var n = (int)ReadVarint(bytes, ref pos);
            t.MaterialRuns.Add((id, n));
        }

        if (bytes[pos++] == 1)
        {
            t.OriginalIndices = new int[objectCount];
            for (var i = 0; i < objectCount; i++)
            {
                t.OriginalIndices[i] = (int)ReadVarint(bytes, ref pos);
            }
        }

        t.Names = ReadStringColumn(bytes, ref pos, objectCount, pool, sequentialAllowed: true);
        t.Layers = ReadStringColumn(bytes, ref pos, objectCount, pool, sequentialAllowed: false);

        var attrCount = (int)ReadVarint(bytes, ref pos);
        t.Attrs = new Dictionary<string, string>[objectCount];
        for (var a = 0; a < attrCount; a++)
        {
            var key = pool[(int)ReadVarint(bytes, ref pos)];
            var n = (int)ReadVarint(bytes, ref pos);
            var indices = new int[n];
            var idx = 0;
            for (var i = 0; i < n; i++)
            {
                idx += (int)ReadVarint(bytes, ref pos);
                indices[i] = idx;
            }

            for (var i = 0; i < n; i++)
            {
                var value = pool[(int)ReadVarint(bytes, ref pos)];
                var dict = t.Attrs[indices[i]] ??= new Dictionary<string, string>();
                dict[key] = value;
            }
        }

        return t;
    }

    private static void WriteMaterialRuns(Stream s, DisplayBatch batch)
    {
        var runs = new List<(int id, int count)>();
        if (batch.Groups != null)
        {
            foreach (var g in batch.Groups)
            {
                var n = g.Meshes?.Count ?? 0;
                if (n > 0)
                {
                    runs.Add((g.MaterialId, n));
                }
            }
        }

        WriteVarint(s, (uint)runs.Count);
        foreach (var (id, count) in runs)
        {
            WriteVarint(s, (uint)id);
            WriteVarint(s, (uint)count);
        }
    }

    private static void WriteOriginalIndexColumn(
        Stream s, List<(string name, string layer, int originalIndex, Dictionary<string, string> attrs)> objects)
    {
        var identity = true;
        for (var i = 0; i < objects.Count; i++)
        {
            if (objects[i].originalIndex != i)
            {
                identity = false;
                break;
            }
        }

        s.WriteByte(identity ? (byte)0 : (byte)1);
        if (!identity)
        {
            foreach (var o in objects)
            {
                WriteVarint(s, (uint)Math.Max(0, o.originalIndex));
            }
        }
    }

    private static void WriteStringColumn(Stream s, List<string> values, StringPool pool, bool allowSequential)
    {
        var allEmpty = values.All(string.IsNullOrEmpty);
        if (allEmpty)
        {
            s.WriteByte(NamesNone);
            return;
        }

        if (allowSequential)
        {
            var sequential = true;
            for (var i = 0; i < values.Count; i++)
            {
                if (values[i] != (i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture))
                {
                    sequential = false;
                    break;
                }
            }

            if (sequential)
            {
                s.WriteByte(NamesSequential);
                return;
            }
        }

        s.WriteByte(NamesPool);
        foreach (var v in values)
        {
            WriteVarint(s, (uint)pool.Intern(v ?? ""));
        }
    }

    private static string[] ReadStringColumn(
        byte[] bytes, ref int pos, int objectCount, string[] pool, bool sequentialAllowed)
    {
        var mode = bytes[pos++];
        var result = new string[objectCount];
        switch (mode)
        {
            case NamesNone:
                for (var i = 0; i < objectCount; i++)
                {
                    result[i] = "";
                }

                break;
            case NamesSequential when sequentialAllowed:
                for (var i = 0; i < objectCount; i++)
                {
                    result[i] = (i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
                }

                break;
            case NamesPool:
                for (var i = 0; i < objectCount; i++)
                {
                    result[i] = pool[(int)ReadVarint(bytes, ref pos)];
                }

                break;
            default:
                throw new InvalidDataException($"Unknown string column mode {mode}.");
        }

        return result;
    }

    private static void WriteAttrColumns(
        Stream s, List<(string name, string layer, int originalIndex, Dictionary<string, string> attrs)> objects,
        StringPool pool)
    {
        // Pivot per-object dicts into per-key sparse columns: the key is stored once, then only
        // the objects carrying it. Empty metadata costs zero bytes.
        var byKey = new SortedDictionary<string, List<(int objIndex, string value)>>(StringComparer.Ordinal);
        for (var i = 0; i < objects.Count; i++)
        {
            var attrs = objects[i].attrs;
            if (attrs == null)
            {
                continue;
            }

            foreach (var kv in attrs)
            {
                if (kv.Key == null || kv.Value == null)
                {
                    continue;
                }

                if (!byKey.TryGetValue(kv.Key, out var list))
                {
                    byKey[kv.Key] = list = new List<(int, string)>();
                }

                list.Add((i, kv.Value));
            }
        }

        WriteVarint(s, (uint)byKey.Count);
        foreach (var kv in byKey)
        {
            WriteVarint(s, (uint)pool.Intern(kv.Key));
            WriteVarint(s, (uint)kv.Value.Count);
            var prev = 0;
            foreach (var (objIndex, _) in kv.Value)
            {
                WriteVarint(s, (uint)(objIndex - prev));
                prev = objIndex;
            }

            foreach (var (_, value) in kv.Value)
            {
                WriteVarint(s, (uint)pool.Intern(value));
            }
        }
    }

    // ============================================================================
    // BATCH RECONSTRUCTION
    // ============================================================================

    private static List<MaterialGroup> BuildGroups(Table t)
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
                    Name = t.Names[meshIndex],
                    Layer = t.Layers[meshIndex],
                    OriginalIndex = t.OriginalIndices?[meshIndex] ?? meshIndex,
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
        Table t, byte[] crvsBlob, byte[] pntsBlob, SelvaExtension ext, string batchId)
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
            var ordinal = t.OriginalIndices?[objIndex] ?? objIndex;
            items.Add(new DisplayItem
            {
                Kind = "curve",
                Json = json,
                Points = pts,
                Id = batchId != null ? $"{batchId}:{ordinal}" : null,
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
            var ordinal = t.OriginalIndices?[objIndex] ?? objIndex;
            items.Add(new DisplayItem
            {
                Kind = "point",
                Position = new DisplayPosition
                {
                    X = pointVerts[p * 3],
                    Y = pointVerts[p * 3 + 1],
                    Z = pointVerts[p * 3 + 2]
                },
                Id = batchId != null ? $"{batchId}:{ordinal}" : null,
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
            WriteVarint(ms, (uint)mimeBytes.Length);
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
                var mimeLen = (int)ReadVarint(tex, ref pos);
                var mime = Encoding.UTF8.GetString(tex, pos, mimeLen);
                pos += mimeLen;
                m.Map = "data:" + mime + ";base64," + Convert.ToBase64String(tex, pos, tex.Length - pos);
            }
        }

        return materials;
    }

    // ============================================================================
    // SELVA EXTENSION
    // ============================================================================

    private sealed class SelvaExtension
    {
        /// <summary>
        ///     The batch's identity namespace — see <see cref="DisplayBatch.BatchId" />. v2 is new,
        ///     so it uses the accurate name here; the legacy <c>sourceComponentId</c> spelling below
        ///     is still read, because a batch decoded from a pre-v2 blob and rewritten as v2 would
        ///     otherwise lose its identity (and with it every hidden/selected object in the viewer).
        /// </summary>
        [JsonProperty("batchId", NullValueHandling = NullValueHandling.Ignore)]
        public string BatchId { get; set; }

        /// <summary>Read-only alias for containers written before the field was renamed.</summary>
        [JsonProperty("sourceComponentId", NullValueHandling = NullValueHandling.Ignore)]
        public string LegacyBatchId { get; set; }

        /// <summary>Rhino NURBS JSON per curve, keyed by global object index (as a string).</summary>
        [JsonProperty("curves", NullValueHandling = NullValueHandling.Ignore)]
        public Dictionary<string, string> Curves { get; set; }
    }

    private static byte[] BuildSelvaExtension(string batchId, List<DisplayItem> curves, int meshCount)
    {
        Dictionary<string, string> curveJson = null;
        if (curves != null)
        {
            for (var c = 0; c < curves.Count; c++)
            {
                if (string.IsNullOrEmpty(curves[c].Json))
                {
                    continue;
                }

                curveJson ??= new Dictionary<string, string>();
                // Keyed by global object index: curves sit right after the meshes.
                curveJson[(meshCount + c).ToString(System.Globalization.CultureInfo.InvariantCulture)] =
                    curves[c].Json;
            }
        }

        return BuildSelvaExtension(batchId, curveJson);
    }

    private static byte[] BuildSelvaExtension(string batchId, Dictionary<string, string> curveJson)
    {
        if (batchId == null && (curveJson == null || curveJson.Count == 0))
        {
            return null;
        }

        var ext = new SelvaExtension { BatchId = batchId, Curves = curveJson };
        var payload = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(ext));
        var ns = Encoding.UTF8.GetBytes(SelvaGhNamespace);
        using (var ms = new MemoryStream())
        {
            WriteVarint(ms, (uint)ns.Length);
            ms.Write(ns, 0, ns.Length);
            ms.Write(payload, 0, payload.Length);
            return ms.ToArray();
        }
    }

    private static SelvaExtension ReadSelvaExtension(List<(uint type, byte[] payload)> chunks)
    {
        foreach (var (type, payload) in chunks)
        {
            if (type != ChunkExtn)
            {
                continue;
            }

            var pos = 0;
            var nsLen = (int)ReadVarint(payload, ref pos);
            var ns = Encoding.UTF8.GetString(payload, pos, nsLen);
            pos += nsLen;
            if (ns != SelvaGhNamespace)
            {
                continue;
            }

            var json = Encoding.UTF8.GetString(payload, pos, payload.Length - pos);
            return JsonConvert.DeserializeObject<SelvaExtension>(json);
        }

        return null;
    }

    /// <summary>Item ids are "{batchId}:{ordinal}"; the ordinal is the original index.</summary>
    private static int ParseItemOrdinal(string id)
    {
        var colon = id?.LastIndexOf(':') ?? -1;
        return colon >= 0 && int.TryParse(id.Substring(colon + 1), out var ordinal) ? ordinal : 0;
    }

    // ============================================================================
    // PRIMITIVES
    // ============================================================================

    private sealed class StringPool
    {
        private readonly List<string> _strings = new List<string>();
        private readonly Dictionary<string, int> _index = new Dictionary<string, int>(StringComparer.Ordinal);

        public int Intern(string s)
        {
            if (_index.TryGetValue(s, out var i))
            {
                return i;
            }

            i = _strings.Count;
            _strings.Add(s);
            _index[s] = i;
            return i;
        }

        public void WriteTo(Stream stream)
        {
            WriteVarint(stream, (uint)_strings.Count);
            foreach (var s in _strings)
            {
                var bytes = Encoding.UTF8.GetBytes(s);
                WriteVarint(stream, (uint)bytes.Length);
                stream.Write(bytes, 0, bytes.Length);
            }
        }
    }

    private static void WriteVarint(Stream s, uint value)
    {
        while (value >= 0x80)
        {
            s.WriteByte((byte)(value | 0x80));
            value >>= 7;
        }

        s.WriteByte((byte)value);
    }

    private static uint ReadVarint(byte[] bytes, ref int pos)
    {
        uint value = 0;
        var shift = 0;
        while (true)
        {
            if (pos >= bytes.Length || shift > 28)
            {
                throw new InvalidDataException("Malformed varint in SLVM table.");
            }

            var b = bytes[pos++];
            value |= (uint)(b & 0x7F) << shift;
            if ((b & 0x80) == 0)
            {
                return value;
            }

            shift += 7;
        }
    }
}
