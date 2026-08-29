using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Selva.Slva;

namespace Selva.Tests;

/// <summary>
///     Combining batches is a full decode → re-encode, so the risks are all in what survives it:
///     geometry (positions must land where they started, despite a new quantization grid), material
///     dedupe across inputs, and the provenance attrs that replace the source ids the merge
///     necessarily discards.
/// </summary>
public class DisplayBatchCombinerTests
{
    private static ThreeMaterial Material(Color color)
    {
        var m = ThreeMaterial.Default();
        m.Color = color;
        return m;
    }

    /// <summary>A unit quad at (dx, dy, 0), as its own single-mesh batch.</summary>
    private static DisplayBatch QuadBatch(
        float dx, float dy, ThreeMaterial material, string name, string sourceId,
        Dictionary<string, string> metadata = null, string layer = null)
    {
        var verts = new[]
        {
            dx, dy, 0f, dx + 1, dy, 0f, dx + 1, dy + 1, 0f, dx, dy + 1, 0f
        };

        return MeshBatchAssembler.CreateBatch(
            new List<float[]> { verts },
            new List<int[]> { new[] { 0, 1, 2, 0, 2, 3 } },
            new List<string> { name },
            new List<ThreeMaterial> { material },
            metadataList: metadata != null ? new List<Dictionary<string, string>> { metadata } : null,
            layers: layer != null ? new List<string> { layer } : null,
            batchId: sourceId);
    }

    private static List<MeshMetadata> AllMeshes(DisplayBatch batch)
    {
        return batch.Groups.SelectMany(g => g.Meshes).ToList();
    }

    /// <summary>World position of a mesh's first vertex, through the combined blob.</summary>
    private static (double x, double y) FirstVertex(DisplayBatch batch, MeshMetadata mesh)
    {
        var decoded = BinaryGeometryReader.Read(batch.CompressedData);
        var c = mesh.VertexStart * 3;
        return (decoded.Vertices[c], decoded.Vertices[c + 1]);
    }

    [Fact]
    public void Combine_MergesMeshesFromEveryInput()
    {
        var red = Material(Color.Red);
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A"),
            QuadBatch(10, 0, red, "b", "src-B")
        }, "combined-1");

        Assert.NotNull(result);
        Assert.Equal(2, result.MeshCount);
        Assert.Empty(result.Failures);

        var meshes = AllMeshes(result.Batch);
        Assert.Equal(new[] { "a", "b" }, meshes.Select(m => m.Name));
        Assert.Equal("combined-1", result.Batch.BatchId);
    }

    [Fact]
    public void Combine_DedupesIdenticalMaterialsAcrossInputs()
    {
        // Two batches each carrying "red" must collapse to ONE group — that's a draw call saved in
        // the browser, and the whole point of combining rather than sending both payloads.
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, Material(Color.Red), "a", "src-A"),
            QuadBatch(10, 0, Material(Color.Red), "b", "src-B")
        }, "combined-1");

        Assert.Single(result.Batch.Materials);
        Assert.Single(result.Batch.Groups);
        Assert.Equal(2, result.Batch.Groups[0].Meshes.Count);
    }

    [Fact]
    public void Combine_KeepsDistinctMaterialsApart()
    {
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, Material(Color.Red), "a", "src-A"),
            QuadBatch(10, 0, Material(Color.Blue), "b", "src-B")
        }, "combined-1");

        Assert.Equal(2, result.Batch.Materials.Count);
        Assert.Equal(2, result.Batch.Groups.Count);
    }

    [Fact]
    public void Combine_PreservesGeometryThroughTheRequantization()
    {
        // The combined batch gets a new bbox spanning both inputs, so every vertex is re-quantized
        // against a coarser grid than it was written with. Positions must still land where they
        // started — this is the check that the decode/re-encode is lossless enough to be usable.
        var red = Material(Color.Red);
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "near", "src-A"),
            QuadBatch(100, 50, red, "far", "src-B")
        }, "combined-1");

        var meshes = AllMeshes(result.Batch);
        var near = FirstVertex(result.Batch, meshes.Single(m => m.Name == "near"));
        var far = FirstVertex(result.Batch, meshes.Single(m => m.Name == "far"));

        Assert.Equal(0, near.x, 2);
        Assert.Equal(0, near.y, 2);
        Assert.Equal(100, far.x, 2);
        Assert.Equal(50, far.y, 2);
    }

    [Fact]
    public void Combine_RecordsWhereEachMeshCameFrom()
    {
        // The combined batch has one batchId, so "which Display produced this mesh?"
        // can only be answered by the provenance attrs.
        var red = Material(Color.Red);
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A"),
            QuadBatch(10, 0, red, "b", "src-B")
        }, "combined-1");

        var meshes = AllMeshes(result.Batch);
        var a = meshes.Single(m => m.Name == "a");
        var b = meshes.Single(m => m.Name == "b");

        Assert.Equal("src-A", a.Metadata[DisplayBatchCombiner.SourceComponentAttr]);
        Assert.Equal("src-B", b.Metadata[DisplayBatchCombiner.SourceComponentAttr]);
        // Each came first within its own source batch, so both are 0 — the pair
        // (component, index) is what identifies a source mesh, not the index alone.
        Assert.Equal("0", a.Metadata[DisplayBatchCombiner.SourceIndexAttr]);
        Assert.Equal("0", b.Metadata[DisplayBatchCombiner.SourceIndexAttr]);
    }

    [Fact]
    public void Combine_NumbersMeshesByTheirPositionWithinTheSourceBatch()
    {
        // The index must count position inside the source batch, NOT read MeshMetadata.OriginalIndex
        // — a multi-mesh batch that has been through the assembler's material sort carries
        // OriginalIndex values in input order, which no longer matches table order.
        var red = Material(Color.Red);
        var blue = Material(Color.Blue);
        var multi = MeshBatchAssembler.CreateBatch(
            new List<float[]>
            {
                new[] { 0f, 0f, 0f, 1f, 0f, 0f, 1f, 1f, 0f },
                new[] { 5f, 0f, 0f, 6f, 0f, 0f, 6f, 1f, 0f },
                new[] { 10f, 0f, 0f, 11f, 0f, 0f, 11f, 1f, 0f }
            },
            new List<int[]> { new[] { 0, 1, 2 }, new[] { 0, 1, 2 }, new[] { 0, 1, 2 } },
            new List<string> { "first", "second", "third" },
            // Interleaved materials force the sort to reorder the table.
            new List<ThreeMaterial> { red, blue, red },
            batchId: "src-multi");

        var result = DisplayBatchCombiner.Combine(new[] { multi }, "combined-1");

        var indices = AllMeshes(result.Batch)
            .Select(m => int.Parse(m.Metadata[DisplayBatchCombiner.SourceIndexAttr]))
            .OrderBy(i => i)
            .ToList();

        Assert.Equal(new[] { 0, 1, 2 }, indices);
    }

    [Fact]
    public void Combine_KeepsProvenanceUniqueAcrossManyBatchesSharingOneSourceId()
    {
        // The real canvas shape: ONE Display emitting a tree arrives as many single-mesh batches
        // that all carry that Display's id. A counter restarting per input would give every mesh
        // the same (component, index) pair, which identifies nothing — the count has to continue
        // across inputs sharing an id.
        var red = Material(Color.Red);
        var inputs = Enumerable.Range(0, 5)
            .Select(i => QuadBatch(i * 5, 0, red, $"q{i}", "one-display"))
            .ToList();

        var result = DisplayBatchCombiner.Combine(inputs, "combined-1");

        var pairs = AllMeshes(result.Batch)
            .Select(m => m.Metadata[DisplayBatchCombiner.SourceComponentAttr] + ":" +
                         m.Metadata[DisplayBatchCombiner.SourceIndexAttr])
            .ToList();

        Assert.Equal(5, pairs.Distinct().Count());
    }

    [Fact]
    public void Combine_KeepsUserMetadataAlongsideProvenance()
    {
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, Material(Color.Red), "a", "src-A",
                metadata: new Dictionary<string, string> { ["fire"] = "REI60" },
                layer: "Structure/Walls")
        }, "combined-1");

        var mesh = AllMeshes(result.Batch).Single();
        Assert.Equal("REI60", mesh.Metadata["fire"]);
        Assert.Equal("src-A", mesh.Metadata[DisplayBatchCombiner.SourceComponentAttr]);
        Assert.Equal("Structure/Walls", mesh.Layer);
    }

    [Fact]
    public void Combine_DoesNotOverwriteProvenanceFromAnEarlierCombine()
    {
        // Combining a combined batch must keep the ORIGINAL source, not relabel every mesh with
        // the intermediate combiner's id — otherwise provenance decays with each merge.
        var red = Material(Color.Red);
        var first = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A")
        }, "combined-1");

        var second = DisplayBatchCombiner.Combine(new[] { first.Batch }, "combined-2");

        var mesh = AllMeshes(second.Batch).Single();
        Assert.Equal("src-A", mesh.Metadata[DisplayBatchCombiner.SourceComponentAttr]);
        Assert.Equal("combined-2", second.Batch.BatchId);
    }

    [Fact]
    public void Combine_CarriesItemsAndRenumbersTheirIds()
    {
        // Item ids must stay unique inside the combined batch; two inputs each holding ":0" would
        // otherwise collide and break web pick selection.
        var batchA = QuadBatch(0, 0, Material(Color.Red), "a", "src-A");
        batchA.Items = new List<DisplayItem>
        {
            DisplayItem.Curve("{}", new double[] { 0, 0, 0, 1, 1, 1 }, "src-A:0", "curveA", "", null, null, null)
        };
        var batchB = QuadBatch(10, 0, Material(Color.Red), "b", "src-B");
        batchB.Items = new List<DisplayItem>
        {
            DisplayItem.Curve("{}", new double[] { 5, 5, 0, 6, 6, 0 }, "src-B:0", "curveB", "", null, null, null)
        };

        var result = DisplayBatchCombiner.Combine(new[] { batchA, batchB }, "combined-1");

        Assert.Equal(2, result.ItemCount);
        Assert.Equal(new[] { "combined-1:0", "combined-1:1" }, result.Batch.Items.Select(i => i.Id));
        Assert.Equal(new[] { "curveA", "curveB" }, result.Batch.Items.Select(i => i.Name));
    }

    [Fact]
    public void Combine_SkipsAnUnreadableInputAndReportsIt()
    {
        // One corrupt payload must not lose every other input's geometry.
        var good = QuadBatch(0, 0, Material(Color.Red), "a", "src-A");
        var broken = QuadBatch(10, 0, Material(Color.Red), "b", "src-B");
        broken.CompressedData = new byte[] { 0xDE, 0xAD, 0xBE, 0xEF, 1, 2, 3, 4 };

        var result = DisplayBatchCombiner.Combine(new[] { good, broken }, "combined-1");

        Assert.Equal(1, result.MeshCount);
        Assert.Single(result.Failures);
    }

    [Fact]
    public void Combine_ReturnsNullWhenThereIsNothingToCombine()
    {
        Assert.Null(DisplayBatchCombiner.Combine(new DisplayBatch[] { null, null }, "combined-1"));
        Assert.Null(DisplayBatchCombiner.Combine(Array.Empty<DisplayBatch>(), "combined-1"));
    }

    [Fact]
    public void Combine_IsIdempotentForASingleInput()
    {
        // Tree-aware combining runs per branch, and a branch holding one payload is the common
        // case — it must survive the merge unchanged rather than pay for a needless re-encode bug.
        var original = QuadBatch(0, 0, Material(Color.Red), "solo", "src-A",
            metadata: new Dictionary<string, string> { ["fire"] = "REI60" },
            layer: "Structure/Walls");

        var result = DisplayBatchCombiner.Combine(new[] { original }, "combined-1");

        var mesh = Assert.Single(AllMeshes(result.Batch));
        Assert.Equal("solo", mesh.Name);
        Assert.Equal("Structure/Walls", mesh.Layer);
        Assert.Equal("REI60", mesh.Metadata["fire"]);
        Assert.Equal(4, mesh.VertexCount);
        Assert.Equal(6, mesh.IndexCount);
    }

    [Fact]
    public void Combine_ProducesAReadableSlvmContainer()
    {
        var red = Material(Color.Red);
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A"),
            QuadBatch(10, 0, red, "b", "src-B")
        }, "combined-1");

        Assert.True(SlvmDocument.IsSlvm(result.Batch.CompressedData));
        var reread = SlvmDocument.Read(result.Batch.CompressedData);
        Assert.Equal(2, AllMeshes(reread.Batch).Count);
        Assert.Equal("combined-1", reread.Batch.BatchId);
    }
}
