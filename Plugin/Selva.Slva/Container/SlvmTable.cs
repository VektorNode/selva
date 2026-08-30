using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Selva.Slva;

/// <summary>
///     The TABL chunk: the columnar object table. Byte layout, in order (all varints are
///     unsigned LEB128):
///
///     [varint] meshCount, curveCount, pointCount
///     string pool: [varint stringCount], per string [varint byteLen][utf8]
///     per mesh:   [varint vertexCount][varint triangleCount]
///     per curve:  [varint pointCount]
///     (points are one point per object — no counts)
///     material runs (meshes only, in table order): [varint runCount],
///                 per run [varint materialId][varint meshCount]
///     names column:  [u8 mode] 0 = all empty, 1 = sequential "1".."n" over the global object
///                 index (the auto-numbering default), 2 = [varint poolRef] per object.
///     layers column: [u8 mode] 0 = all empty, 2 = [varint poolRef] per object.
///     attrs: [varint attrCount], per attr [varint keyPoolRef][varint n]
///                 n × [varint objIndexDelta] (strictly increasing, delta from previous)
///                 n × [varint valuePoolRef]
///
///     Attr keys are namespaced by convention ("gh:branch", "ifc:guid", "style:color"); the
///     table mechanism itself knows nothing about any namespace. Two kinds of reserved key are
///     split back out of the attr dict on read: "id" (object identity) and "style:*"
///     (curve/point styling).
/// </summary>
internal static class SlvmTable
{
    // Name column modes. Sequential covers the default auto-numbering ("1".."n") at zero bytes.
    private const byte NamesNone = 0;
    private const byte NamesSequential = 1;
    private const byte NamesPool = 2;

    internal sealed class Table
    {
        public int MeshCount, CurveCount, PointCount;
        public int[] MeshVertexCounts, MeshTriCounts, CurvePointCounts;
        public List<(int materialId, int meshCount)> MaterialRuns;
        public string[] Ids; // per object, null when the writer minted none
        public string[] Names, Layers;
        public Dictionary<string, string>[] Attrs; // per object, null when none
    }

    public static byte[] Write(
        DisplayBatch batch, List<MeshMetadata> meshes, List<DisplayItem> curves, List<DisplayItem> points)
    {
        var objects = new List<(string name, string layer, Dictionary<string, string> attrs)>();
        foreach (var m in meshes)
        {
            objects.Add((m.Name, m.Layer, WithId(m.Metadata, m.Id)));
        }

        foreach (var item in curves.Concat(points))
        {
            var attrs = item.Metadata != null
                ? new Dictionary<string, string>(item.Metadata)
                : new Dictionary<string, string>();
            if (!string.IsNullOrEmpty(item.Id))
            {
                attrs[SlvmDocument.IdKey] = item.Id;
            }

            if (item.Color != null)
            {
                attrs[SlvmDocument.StyleColorKey] = item.Color;
            }

            if (item.Opacity.HasValue)
            {
                attrs[SlvmDocument.StyleOpacityKey] =
                    item.Opacity.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }

            objects.Add((item.Name, item.Layer, attrs.Count > 0 ? attrs : null));
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
                    Varint.Write(cs, (uint)m.VertexCount);
                    Varint.Write(cs, (uint)(m.IndexCount / 3));
                }

                foreach (var c in curves)
                {
                    Varint.Write(cs, (uint)((c.Points?.Length ?? 0) / 3));
                }

                WriteMaterialRuns(cs, batch);
                WriteStringColumn(cs, objects.Select(o => o.name).ToList(), pool, allowSequential: true);
                WriteStringColumn(cs, objects.Select(o => o.layer).ToList(), pool, allowSequential: false);
                WriteAttrColumns(cs, objects, pool);
                columns = cs.ToArray();
            }

            Varint.Write(ms, (uint)meshes.Count);
            Varint.Write(ms, (uint)curves.Count);
            Varint.Write(ms, (uint)points.Count);
            pool.WriteTo(ms);
            ms.Write(columns, 0, columns.Length);
            return ms.ToArray();
        }
    }

    public static Table Read(byte[] bytes)
    {
        var pos = 0;
        var t = new Table
        {
            MeshCount = (int)Varint.Read(bytes, ref pos),
            CurveCount = (int)Varint.Read(bytes, ref pos),
            PointCount = (int)Varint.Read(bytes, ref pos)
        };
        var objectCount = t.MeshCount + t.CurveCount + t.PointCount;

        var poolCount = (int)Varint.Read(bytes, ref pos);
        var pool = new string[poolCount];
        for (var i = 0; i < poolCount; i++)
        {
            var len = (int)Varint.Read(bytes, ref pos);
            pool[i] = Encoding.UTF8.GetString(bytes, pos, len);
            pos += len;
        }

        t.MeshVertexCounts = new int[t.MeshCount];
        t.MeshTriCounts = new int[t.MeshCount];
        for (var i = 0; i < t.MeshCount; i++)
        {
            t.MeshVertexCounts[i] = (int)Varint.Read(bytes, ref pos);
            t.MeshTriCounts[i] = (int)Varint.Read(bytes, ref pos);
        }

        t.CurvePointCounts = new int[t.CurveCount];
        for (var i = 0; i < t.CurveCount; i++)
        {
            t.CurvePointCounts[i] = (int)Varint.Read(bytes, ref pos);
        }

        var runCount = (int)Varint.Read(bytes, ref pos);
        t.MaterialRuns = new List<(int, int)>(runCount);
        for (var i = 0; i < runCount; i++)
        {
            var id = (int)Varint.Read(bytes, ref pos);
            var n = (int)Varint.Read(bytes, ref pos);
            t.MaterialRuns.Add((id, n));
        }

        t.Names = ReadStringColumn(bytes, ref pos, objectCount, pool, sequentialAllowed: true);
        t.Layers = ReadStringColumn(bytes, ref pos, objectCount, pool, sequentialAllowed: false);

        var attrCount = (int)Varint.Read(bytes, ref pos);
        t.Attrs = new Dictionary<string, string>[objectCount];
        for (var a = 0; a < attrCount; a++)
        {
            var key = pool[(int)Varint.Read(bytes, ref pos)];
            var n = (int)Varint.Read(bytes, ref pos);
            var indices = new int[n];
            var idx = 0;
            for (var i = 0; i < n; i++)
            {
                idx += (int)Varint.Read(bytes, ref pos);
                indices[i] = idx;
            }

            for (var i = 0; i < n; i++)
            {
                var value = pool[(int)Varint.Read(bytes, ref pos)];
                var dict = t.Attrs[indices[i]] ??= new Dictionary<string, string>();
                dict[key] = value;
            }
        }

        // The identity rides the attr mechanism but is a first-class field to consumers.
        t.Ids = new string[objectCount];
        for (var i = 0; i < objectCount; i++)
        {
            var dict = t.Attrs[i];
            if (dict != null && dict.TryGetValue(SlvmDocument.IdKey, out var id))
            {
                t.Ids[i] = id;
                dict.Remove(SlvmDocument.IdKey);
                if (dict.Count == 0)
                {
                    t.Attrs[i] = null;
                }
            }
        }

        return t;
    }

    /// <summary>The object's attrs with its id folded in under the reserved key.</summary>
    private static Dictionary<string, string> WithId(Dictionary<string, string> attrs, string id)
    {
        if (string.IsNullOrEmpty(id))
        {
            return attrs;
        }

        var merged = attrs != null
            ? new Dictionary<string, string>(attrs)
            : new Dictionary<string, string>();
        merged[SlvmDocument.IdKey] = id;
        return merged;
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

        Varint.Write(s, (uint)runs.Count);
        foreach (var (id, count) in runs)
        {
            Varint.Write(s, (uint)id);
            Varint.Write(s, (uint)count);
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
            Varint.Write(s, (uint)pool.Intern(v ?? ""));
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
                    result[i] = pool[(int)Varint.Read(bytes, ref pos)];
                }

                break;
            default:
                throw new InvalidDataException($"Unknown string column mode {mode}.");
        }

        return result;
    }

    private static void WriteAttrColumns(
        Stream s, List<(string name, string layer, Dictionary<string, string> attrs)> objects,
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

        Varint.Write(s, (uint)byKey.Count);
        foreach (var kv in byKey)
        {
            Varint.Write(s, (uint)pool.Intern(kv.Key));
            Varint.Write(s, (uint)kv.Value.Count);
            var prev = 0;
            foreach (var (objIndex, _) in kv.Value)
            {
                Varint.Write(s, (uint)(objIndex - prev));
                prev = objIndex;
            }

            foreach (var (_, value) in kv.Value)
            {
                Varint.Write(s, (uint)pool.Intern(value));
            }
        }
    }

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
            Varint.Write(stream, (uint)_strings.Count);
            foreach (var s in _strings)
            {
                var bytes = Encoding.UTF8.GetBytes(s);
                Varint.Write(stream, (uint)bytes.Length);
                stream.Write(bytes, 0, bytes.Length);
            }
        }
    }
}
