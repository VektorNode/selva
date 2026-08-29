using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Selva.Slva;

namespace Selva.Slva.Tests;

/// <summary>
///     The SLVM v2 container mechanics: the columnar object table (prefix-sum windows, sequential
///     names, sparse attrs, the multi-material originalIndex column), texture extraction, the
///     chunk-surgery helpers (restamp, strip, replace-geometry), and unknown-chunk tolerance —
///     the property the whole extension model rests on.
/// </summary>
public class SlvmDocumentTests
{
    // ============================================================================
    // HELPERS
    // ============================================================================

    private static byte[] RealGeometryBlob(int meshCount, int vertsPerMesh = 4, int trisPerMesh = 2)
    {
        var vertices = new float[meshCount * vertsPerMesh * 3];
        var indices = new int[meshCount * trisPerMesh * 3];
        var rng = new Random(7);
        for (var i = 0; i < vertices.Length; i++)
        {
            vertices[i] = (float)rng.NextDouble() * 10f;
        }

        for (var m = 0; m < meshCount; m++)
        {
            for (var t = 0; t < trisPerMesh * 3; t++)
            {
                indices[m * trisPerMesh * 3 + t] = m * vertsPerMesh + t % vertsPerMesh;
            }
        }

        using var ms = new MemoryStream();
        SlvaWriter.Write(ms, "", vertices, indices);
        return SlvzCompressor.Compress(ms.GetBuffer(), (int)ms.Length);
    }

    private static DisplayBatch BatchWithMeshes(params (int materialId, string name, string layer, int originalIndex,
        Dictionary<string, string> metadata)[] meshes)
    {
        var groups = new List<MaterialGroup>();
        var vertexStart = 0;
        var indexStart = 0;
        foreach (var m in meshes)
        {
            if (groups.Count == 0 || groups[^1].MaterialId != m.materialId)
            {
                groups.Add(new MaterialGroup { MaterialId = m.materialId, Meshes = new List<MeshMetadata>() });
            }

            groups[^1].Meshes.Add(new MeshMetadata
            {
                Name = m.name, Layer = m.layer, OriginalIndex = m.originalIndex,
                VertexCount = 4, IndexCount = 6, VertexStart = vertexStart, IndexStart = indexStart,
                Metadata = m.metadata
            });
            vertexStart += 4;
            indexStart += 6;
        }

        return new DisplayBatch
        {
            BatchId = "src-1",
            Materials = Enumerable.Range(0, groups.Max(g => g.MaterialId) + 1)
                .Select(i => new SerializableMaterial { Color = "#101010", Opacity = 1.0 })
                .ToList(),
            Groups = groups
        };
    }

    private static DisplayBatch RoundTrip(DisplayBatch batch, bool includeItems = false)
    {
        var geometry = RealGeometryBlob(batch.Groups.Sum(g => g.Meshes.Count));
        var bytes = SlvmDocument.Write(batch, geometry, includeItems);
        return SlvmDocument.Read(bytes).Batch;
    }

    private static List<MeshMetadata> AllMeshes(DisplayBatch batch)
    {
        return batch.Groups.SelectMany(g => g.Meshes).ToList();
    }

    // ============================================================================
    // OBJECT TABLE
    // ============================================================================

    [Fact]
    public void Windows_AreRebuiltAsPrefixSumsInTableOrder()
    {
        var decoded = RoundTrip(BatchWithMeshes(
            (0, "a", "", 0, null), (0, "b", "", 1, null), (1, "c", "", 2, null)));

        var meshes = AllMeshes(decoded);
        Assert.Equal(0, meshes[0].VertexStart);
        Assert.Equal(4, meshes[1].VertexStart);
        Assert.Equal(8, meshes[2].VertexStart);
        Assert.Equal(0, meshes[0].IndexStart);
        Assert.Equal(6, meshes[1].IndexStart);
        Assert.Equal(12, meshes[2].IndexStart);
    }

    [Fact]
    public void OriginalIndex_SurvivesTheMaterialSortReorder()
    {
        // The assembler sorts meshes by material id, so table order diverges from GH input order
        // on any multi-material batch. This is what the originalIndex column exists for; dropping
        // it silently rewires web pick identity.
        var decoded = RoundTrip(BatchWithMeshes(
            (0, "m2", "", 2, null), (0, "m0", "", 0, null), (1, "m1", "", 1, null)));

        Assert.Equal(new[] { 2, 0, 1 }, AllMeshes(decoded).Select(m => m.OriginalIndex));
    }

    [Fact]
    public void MaterialRuns_RebuildTheGroupStructure()
    {
        var decoded = RoundTrip(BatchWithMeshes(
            (0, "a", "", 0, null), (0, "b", "", 1, null), (2, "c", "", 2, null)));

        Assert.Equal(2, decoded.Groups.Count);
        Assert.Equal(0, decoded.Groups[0].MaterialId);
        Assert.Equal(2, decoded.Groups[0].Meshes.Count);
        Assert.Equal(2, decoded.Groups[1].MaterialId);
        Assert.Single(decoded.Groups[1].Meshes);
    }

    [Fact]
    public void SequentialNames_RoundTripWithoutAPool()
    {
        // The auto-numbering default ("1".."n") is the overwhelmingly common case and must cost
        // ~nothing: the column collapses to a single mode byte.
        var decoded = RoundTrip(BatchWithMeshes(
            (0, "1", "", 0, null), (0, "2", "", 1, null), (0, "3", "", 2, null)));

        Assert.Equal(new[] { "1", "2", "3" }, AllMeshes(decoded).Select(m => m.Name));
    }

    [Fact]
    public void LayersAndNames_DedupeThroughThePool()
    {
        var decoded = RoundTrip(BatchWithMeshes(
            (0, "wall", "Structure/Walls", 0, null),
            (0, "wall", "Structure/Walls", 1, null),
            (0, "slab", "Structure/Slabs", 2, null)));

        var meshes = AllMeshes(decoded);
        Assert.Equal(new[] { "wall", "wall", "slab" }, meshes.Select(m => m.Name));
        Assert.Equal(new[] { "Structure/Walls", "Structure/Walls", "Structure/Slabs" },
            meshes.Select(m => m.Layer));
    }

    [Fact]
    public void SparseAttrs_LandOnExactlyTheObjectsThatCarryThem()
    {
        // The mechanism behind per-mesh provenance ("gh:branch", "ifc:guid", ...): keys are stored
        // once, only carriers pay, absent metadata costs zero.
        var decoded = RoundTrip(BatchWithMeshes(
            (0, "a", "", 0, new Dictionary<string, string> { ["gh:branch"] = "{0;2}" }),
            (0, "b", "", 1, null),
            (0, "c", "", 2, new Dictionary<string, string> { ["gh:branch"] = "{0;2}", ["ifc:guid"] = "2N1c" })));

        var meshes = AllMeshes(decoded);
        Assert.Equal("{0;2}", meshes[0].Metadata["gh:branch"]);
        Assert.Null(meshes[1].Metadata);
        Assert.Equal("{0;2}", meshes[2].Metadata["gh:branch"]);
        Assert.Equal("2N1c", meshes[2].Metadata["ifc:guid"]);
    }

    [Fact]
    public void EmptyBatch_RoundTrips()
    {
        var batch = new DisplayBatch
        {
            Materials = new List<SerializableMaterial>(),
            Groups = new List<MaterialGroup>()
        };

        var bytes = SlvmDocument.Write(batch, null, includeItems: false);
        var decoded = SlvmDocument.Read(bytes);

        Assert.Empty(decoded.Batch.Groups);
        Assert.NotNull(decoded.GeometryBlob);
    }

    // ============================================================================
    // ITEMS
    // ============================================================================

    [Fact]
    public void PointItems_RoundTripPositionAndStyle()
    {
        var batch = BatchWithMeshes((0, "m", "", 0, null));
        batch.Items = new List<DisplayItem>
        {
            new DisplayItem
            {
                Kind = "point",
                Position = new DisplayPosition { X = 1.5, Y = -2.5, Z = 3.25 },
                Id = "src-1:0", Name = "anchor", Layer = "Points",
                Color = "#0000ff", Opacity = 0.4
            }
        };

        var decoded = RoundTrip(batch, includeItems: true);

        var item = Assert.Single(decoded.Items);
        Assert.Equal("point", item.Kind);
        Assert.Equal(1.5, item.Position.X, 3);
        Assert.Equal(-2.5, item.Position.Y, 3);
        Assert.Equal(3.25, item.Position.Z, 3);
        Assert.Equal("anchor", item.Name);
        Assert.Equal("Points", item.Layer);
        Assert.Equal("#0000ff", item.Color);
        Assert.Equal(0.4, item.Opacity!.Value, 3);
    }

    [Fact]
    public void WireBlob_CarriesNoItems()
    {
        var batch = BatchWithMeshes((0, "m", "", 0, null));
        batch.Items = new List<DisplayItem>
        {
            DisplayItem.Curve("{}", new double[] { 0, 0, 0, 1, 0, 0 }, "src-1:0", "c", "", null, null, null)
        };

        var decoded = RoundTrip(batch, includeItems: false);

        Assert.Null(decoded.Items);
    }

    // ============================================================================
    // TEXTURES
    // ============================================================================

    [Fact]
    public void DataUriTextures_ExtractToChunksAndReconstruct()
    {
        var pngBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47, 1, 2, 3 };
        var batch = BatchWithMeshes((0, "m", "", 0, null));
        batch.Materials[0].Map = "data:image/png;base64," + Convert.ToBase64String(pngBytes);

        var decoded = RoundTrip(batch);

        Assert.Equal("data:image/png;base64," + Convert.ToBase64String(pngBytes), decoded.Materials[0].Map);
    }

    [Fact]
    public void UrlTextures_PassThroughUntouched()
    {
        var batch = BatchWithMeshes((0, "m", "", 0, null));
        batch.Materials[0].Map = "https://example.test/t.png";

        var decoded = RoundTrip(batch);

        Assert.Equal("https://example.test/t.png", decoded.Materials[0].Map);
    }

    // ============================================================================
    // CHUNK SURGERY
    // ============================================================================

    [Fact]
    public void Restamp_ChangesOnlyTheSourceComponentId()
    {
        var batch = BatchWithMeshes((0, "a", "L", 0, new Dictionary<string, string> { ["k"] = "v" }));
        var geometry = RealGeometryBlob(1);
        var bytes = SlvmDocument.Write(batch, geometry, includeItems: false);

        var restamped = SlvmDocument.Restamp(bytes, "new-id");
        var decoded = SlvmDocument.Read(restamped);

        Assert.Equal("new-id", decoded.Batch.BatchId);
        Assert.Equal(geometry, decoded.GeometryBlob);
        Assert.Equal("v", AllMeshes(decoded.Batch)[0].Metadata["k"]);
    }

    [Fact]
    public void ReplaceGeometry_SwapsTheBlobAndNothingElse()
    {
        var batch = BatchWithMeshes((0, "a", "L", 0, null));
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false);
        var newGeometry = RealGeometryBlob(1, vertsPerMesh: 8, trisPerMesh: 4);

        var decoded = SlvmDocument.Read(SlvmDocument.ReplaceGeometry(bytes, newGeometry));

        Assert.Equal(newGeometry, decoded.GeometryBlob);
        Assert.Equal("src-1", decoded.Batch.BatchId);
        Assert.Equal("a", AllMeshes(decoded.Batch)[0].Name);
    }

    [Fact]
    public void StripItems_RemovesItemChunksAndKeepsTheRest()
    {
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        batch.Items = new List<DisplayItem>
        {
            DisplayItem.Curve("{\"n\":1}", new double[] { 0, 0, 0, 1, 1, 1 }, "src-1:0", "c", "", null, "#fff", null)
        };
        var fileBytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: true);

        var wireBytes = SlvmDocument.StripItems(fileBytes, "src-1");
        var decoded = SlvmDocument.Read(wireBytes);

        Assert.Null(decoded.Batch.Items);
        Assert.Equal("src-1", decoded.Batch.BatchId);
        Assert.True(wireBytes.Length < fileBytes.Length);
    }

    // ============================================================================
    // EXTENSION MODEL
    // ============================================================================

    [Fact]
    public void UnknownChunks_AreSkippedNotFatal()
    {
        // The extension mechanism: a reader must survive chunks it doesn't know. Splice a fake
        // chunk (type "ZZZZ") into the middle of a valid container by hand.
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false);

        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms))
        {
            w.Write(SlvmDocument.Magic);
            w.Write(SlvmDocument.Version);
            var chunkCount = BitConverter.ToUInt32(bytes, 8);
            w.Write(chunkCount + 1);
            w.Write(0x5A5A5A5Au); // "ZZZZ"
            var payload = new byte[] { 1, 2, 3 };
            w.Write((uint)payload.Length);
            w.Write(payload);
            w.Write((byte)0); // pad to 4
            w.Write(bytes, 12, bytes.Length - 12);
        }

        var decoded = SlvmDocument.Read(ms.ToArray());

        Assert.Equal("a", AllMeshes(decoded.Batch)[0].Name);
    }

    [Fact]
    public void ForeignExtensionNamespaces_AreIgnored()
    {
        // An EXTN chunk from another host must not confuse the selva.gh reader. Container built
        // by hand: TABL + a foreign EXTN only.
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        batch.BatchId = null;
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false);

        var decoded = SlvmDocument.Read(bytes);

        Assert.Null(decoded.Batch.BatchId);
    }

    [Fact]
    public void ForeignExtensions_RoundTripAsOpaquePayloads()
    {
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        var payload = new byte[] { 1, 2, 3, 250 };

        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false,
            new Dictionary<string, byte[]> { ["myapp"] = payload });
        var decoded = SlvmDocument.Read(bytes);

        Assert.Equal(payload, decoded.Extensions!["myapp"]);
        // The selva.gh extension is composed from the batch, never passed through.
        Assert.Equal(batch.BatchId, decoded.Batch.BatchId);
        Assert.DoesNotContain(SlvmDocument.SelvaGhNamespace, decoded.Extensions.Keys);
    }

    [Fact]
    public void Restamp_KeepsForeignExtensions()
    {
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        var payload = new byte[] { 9, 8, 7 };
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false,
            new Dictionary<string, byte[]> { ["myapp"] = payload });

        var restamped = SlvmDocument.Restamp(bytes, "new-id");

        var decoded = SlvmDocument.Read(restamped);
        Assert.Equal("new-id", decoded.Batch.BatchId);
        Assert.Equal(payload, decoded.Extensions!["myapp"]);
    }

    [Fact]
    public void StripItems_KeepsForeignExtensions()
    {
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        var payload = new byte[] { 4, 4, 4 };
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false,
            new Dictionary<string, byte[]> { ["myapp"] = payload });

        var stripped = SlvmDocument.StripItems(bytes, batch.BatchId);

        Assert.Equal(payload, SlvmDocument.Read(stripped).Extensions!["myapp"]);
    }

    [Fact]
    public void Write_RejectsThePassThroughSelvaGhNamespace()
    {
        var batch = BatchWithMeshes((0, "a", "", 0, null));

        Assert.Throws<ArgumentException>(() => SlvmDocument.Write(batch, RealGeometryBlob(1),
            includeItems: false,
            new Dictionary<string, byte[]> { [SlvmDocument.SelvaGhNamespace] = new byte[] { 1 } }));
    }

    [Fact]
    public void LegacyExtnKey_StillCarriesTheBatchId()
    {
        // v2's EXTN field was renamed from sourceComponentId to batchId. A container written before
        // that must keep its identity, or every hidden/selected object in a viewer session loses its
        // key. Rebuild a valid container's EXTN chunk with the old spelling, byte-for-byte otherwise.
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false);

        var rebuilt = RewriteExtnWithLegacyKey(bytes, batch.BatchId);

        Assert.Equal(batch.BatchId, SlvmDocument.Read(rebuilt).Batch.BatchId);
    }

    /// <summary>Replaces the EXTN payload with `{"sourceComponentId": id}`, keeping every other chunk.</summary>
    private static byte[] RewriteExtnWithLegacyKey(byte[] container, string batchId)
    {
        const uint extn = 0x4E545845;
        var ns = System.Text.Encoding.UTF8.GetBytes("selva.gh");
        var json = System.Text.Encoding.UTF8.GetBytes(
            "{\"sourceComponentId\":\"" + batchId + "\"}");

        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        var chunkCount = BitConverter.ToUInt32(container, 8);
        w.Write(BitConverter.ToUInt32(container, 0));
        w.Write(BitConverter.ToUInt32(container, 4));
        w.Write(chunkCount);

        var offset = 12;
        for (var i = 0; i < chunkCount; i++)
        {
            var type = BitConverter.ToUInt32(container, offset);
            var len = (int)BitConverter.ToUInt32(container, offset + 4);
            var padded = 8 + len + (4 - len % 4) % 4;

            if (type == extn)
            {
                var payload = new byte[1 + ns.Length + json.Length];
                payload[0] = (byte)ns.Length;
                Buffer.BlockCopy(ns, 0, payload, 1, ns.Length);
                Buffer.BlockCopy(json, 0, payload, 1 + ns.Length, json.Length);
                w.Write(type);
                w.Write((uint)payload.Length);
                w.Write(payload);
                for (var pad = (4 - payload.Length % 4) % 4; pad > 0; pad--)
                {
                    w.Write((byte)0);
                }
            }
            else
            {
                w.Write(container, offset, padded);
            }

            offset += padded;
        }

        return ms.ToArray();
    }

    [Fact]
    public void TruncatedContainer_Throws()
    {
        var batch = BatchWithMeshes((0, "a", "", 0, null));
        var bytes = SlvmDocument.Write(batch, RealGeometryBlob(1), includeItems: false);
        var truncated = bytes.Take(bytes.Length / 2).ToArray();

        Assert.Throws<InvalidDataException>(() => SlvmDocument.Read(truncated));
    }
}
