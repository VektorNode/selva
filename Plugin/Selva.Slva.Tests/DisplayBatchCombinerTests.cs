using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Selva.Slva;

namespace Selva.Slva.Tests;

/// <summary>
///     Combining batches is a full decode → re-encode, so the risks are all in what survives it:
///     geometry (positions must land where they started, despite a new quantization grid), material
///     dedupe across inputs, and the object ids — which pass through untouched, since they already
///     name their producer and are the viewer's identity keys.
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
        float dx, float dy, ThreeMaterial material, string name, string id,
        Dictionary<string, string> metadata = null, string layer = null)
    {
        var verts = new[]
        {
            dx, dy, 0f, dx + 1, dy, 0f, dx + 1, dy + 1, 0f, dx, dy + 1, 0f
        };

        return MeshBatchAssembler.CreateBatch(
            new List<SlvaMeshInput>
            {
                new SlvaMeshInput
                {
                    Id = id,
                    Vertices = verts,
                    Faces = new[] { 0, 1, 2, 0, 2, 3 },
                    Name = name,
                    Layer = layer,
                    Material = material,
                    Metadata = metadata
                }
            });
    }

    private static List<MeshMetadata> AllMeshes(DisplayBatch batch)
    {
        return batch.Groups.SelectMany(g => g.Meshes).ToList();
    }

    /// <summary>World position of a mesh's first vertex, through the combined blob.</summary>
    private static (double x, double y) FirstVertex(DisplayBatch batch, MeshMetadata mesh)
    {
        var decoded = SlvaReader.Read(batch.CompressedData);
        var c = mesh.VertexStart * 3;
        return (decoded.Vertices[c], decoded.Vertices[c + 1]);
    }

    [Fact]
    public void Combine_MergesMeshesFromEveryInput()
    {
        var red = Material(Color.Red);
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A/{0}/0"),
            QuadBatch(10, 0, red, "b", "src-B/{0}/0")
        });

        Assert.NotNull(result);
        Assert.Equal(2, result.MeshCount);
        Assert.Empty(result.Failures);

        var meshes = AllMeshes(result.Batch);
        Assert.Equal(new[] { "a", "b" }, meshes.Select(m => m.Name));
    }

    [Fact]
    public void Combine_DedupesIdenticalMaterialsAcrossInputs()
    {
        // Two batches each carrying "red" must collapse to ONE group — that's a draw call saved in
        // the browser, and the whole point of combining rather than sending both payloads.
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, Material(Color.Red), "a", "src-A/{0}/0"),
            QuadBatch(10, 0, Material(Color.Red), "b", "src-B/{0}/0")
        });

        Assert.Single(result.Batch.Materials);
        Assert.Single(result.Batch.Groups);
        Assert.Equal(2, result.Batch.Groups[0].Meshes.Count);
    }

    [Fact]
    public void Combine_KeepsDistinctMaterialsApart()
    {
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, Material(Color.Red), "a", "src-A/{0}/0"),
            QuadBatch(10, 0, Material(Color.Blue), "b", "src-B/{0}/0")
        });

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
            QuadBatch(0, 0, red, "near", "src-A/{0}/0"),
            QuadBatch(100, 50, red, "far", "src-B/{0}/0")
        });

        var meshes = AllMeshes(result.Batch);
        var near = FirstVertex(result.Batch, meshes.Single(m => m.Name == "near"));
        var far = FirstVertex(result.Batch, meshes.Single(m => m.Name == "far"));

        Assert.Equal(0, near.x, 2);
        Assert.Equal(0, near.y, 2);
        Assert.Equal(100, far.x, 2);
        Assert.Equal(50, far.y, 2);
    }

    [Fact]
    public void Combine_PassesObjectIdsThroughUntouched()
    {
        // The id already names its producer, so it IS the provenance — and the viewer's hidden
        // state survives the combine only if the id comes out byte-identical.
        var red = Material(Color.Red);
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A/{0;1}/0"),
            QuadBatch(10, 0, red, "b", "src-B/{0}/7")
        });

        var meshes = AllMeshes(result.Batch);
        Assert.Equal("src-A/{0;1}/0", meshes.Single(m => m.Name == "a").Id);
        Assert.Equal("src-B/{0}/7", meshes.Single(m => m.Name == "b").Id);
    }

    [Fact]
    public void Combine_KeepsIdsThroughTheMaterialSortReorder()
    {
        var red = Material(Color.Red);
        var blue = Material(Color.Blue);
        // Interleaved materials force the sort to reorder the table.
        var multi = MeshBatchAssembler.CreateBatch(
            new List<SlvaMeshInput>
            {
                new SlvaMeshInput
                {
                    Id = "src/{0}/0",
                    Vertices = new[] { 0f, 0f, 0f, 1f, 0f, 0f, 1f, 1f, 0f },
                    Faces = new[] { 0, 1, 2 }, Name = "first", Material = red
                },
                new SlvaMeshInput
                {
                    Id = "src/{0}/1",
                    Vertices = new[] { 5f, 0f, 0f, 6f, 0f, 0f, 6f, 1f, 0f },
                    Faces = new[] { 0, 1, 2 }, Name = "second", Material = blue
                },
                new SlvaMeshInput
                {
                    Id = "src/{0}/2",
                    Vertices = new[] { 10f, 0f, 0f, 11f, 0f, 0f, 11f, 1f, 0f },
                    Faces = new[] { 0, 1, 2 }, Name = "third", Material = red
                }
            });

        var result = DisplayBatchCombiner.Combine(new[] { multi });

        var byName = AllMeshes(result.Batch).ToDictionary(m => m.Name);
        Assert.Equal("src/{0}/0", byName["first"].Id);
        Assert.Equal("src/{0}/1", byName["second"].Id);
        Assert.Equal("src/{0}/2", byName["third"].Id);
    }

    [Fact]
    public void Combine_KeepsUserMetadataAndLayer()
    {
        var result = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, Material(Color.Red), "a", "src-A/{0}/0",
                metadata: new Dictionary<string, string> { ["fire"] = "REI60" },
                layer: "Structure/Walls")
        });

        var mesh = AllMeshes(result.Batch).Single();
        Assert.Equal("REI60", mesh.Metadata["fire"]);
        Assert.Equal("src-A/{0}/0", mesh.Id);
        Assert.Equal("Structure/Walls", mesh.Layer);
    }

    [Fact]
    public void Combine_SurvivesASecondCombineWithIdsIntact()
    {
        // Combining a combined batch must keep the ORIGINAL ids — otherwise identity (and the
        // viewer state hanging off it) decays with each merge.
        var red = Material(Color.Red);
        var first = DisplayBatchCombiner.Combine(new[]
        {
            QuadBatch(0, 0, red, "a", "src-A/{0}/0")
        });

        var second = DisplayBatchCombiner.Combine(new[] { first.Batch });

        var mesh = AllMeshes(second.Batch).Single();
        Assert.Equal("src-A/{0}/0", mesh.Id);
    }

    [Fact]
    public void Combine_CarriesItemsWithTheirIds()
    {
        // Items keep their minted ids too — uniqueness across inputs is the minters' guarantee,
        // not the combiner's job.
        var batchA = QuadBatch(0, 0, Material(Color.Red), "a", "src-A/{0}/0");
        batchA.Items = new List<DisplayItem>
        {
            DisplayItem.Curve("{}", new double[] { 0, 0, 0, 1, 1, 1 }, "src-A/{0}/1", "curveA", "", null, null, null)
        };
        var batchB = QuadBatch(10, 0, Material(Color.Red), "b", "src-B/{0}/0");
        batchB.Items = new List<DisplayItem>
        {
            DisplayItem.Curve("{}", new double[] { 5, 5, 0, 6, 6, 0 }, "src-B/{0}/1", "curveB", "", null, null, null)
        };

        var result = DisplayBatchCombiner.Combine(new[] { batchA, batchB });

        Assert.Equal(2, result.ItemCount);
        Assert.Equal(new[] { "src-A/{0}/1", "src-B/{0}/1" }, result.Batch.Items.Select(i => i.Id));
        Assert.Equal(new[] { "curveA", "curveB" }, result.Batch.Items.Select(i => i.Name));
    }

    [Fact]
    public void Combine_SkipsAnUnreadableInputAndReportsIt()
    {
        // One corrupt payload must not lose every other input's geometry.
        var good = QuadBatch(0, 0, Material(Color.Red), "a", "src-A/{0}/0");
        var broken = QuadBatch(10, 0, Material(Color.Red), "b", "src-B/{0}/0");
        broken.CompressedData = new byte[] { 0xDE, 0xAD, 0xBE, 0xEF, 1, 2, 3, 4 };

        var result = DisplayBatchCombiner.Combine(new[] { good, broken });

        Assert.Equal(1, result.MeshCount);
        Assert.Single(result.Failures);
    }

    [Fact]
    public void Combine_ReturnsNullWhenThereIsNothingToCombine()
    {
        Assert.Null(DisplayBatchCombiner.Combine(new DisplayBatch[] { null, null }));
        Assert.Null(DisplayBatchCombiner.Combine(Array.Empty<DisplayBatch>()));
    }

    [Fact]
    public void Combine_IsIdempotentForASingleInput()
    {
        // Tree-aware combining runs per branch, and a branch holding one payload is the common
        // case — it must survive the merge unchanged rather than pay for a needless re-encode bug.
        var original = QuadBatch(0, 0, Material(Color.Red), "solo", "src-A/{0}/0",
            metadata: new Dictionary<string, string> { ["fire"] = "REI60" },
            layer: "Structure/Walls");

        var result = DisplayBatchCombiner.Combine(new[] { original });

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
            QuadBatch(0, 0, red, "a", "src-A/{0}/0"),
            QuadBatch(10, 0, red, "b", "src-B/{0}/0")
        });

        Assert.True(SlvmDocument.IsSlvm(result.Batch.CompressedData));
        var reread = SlvmDocument.Read(result.Batch.CompressedData);
        Assert.Equal(2, AllMeshes(reread.Batch).Count);
        Assert.Equal(new[] { "src-A/{0}/0", "src-B/{0}/0" },
            AllMeshes(reread.Batch).Select(m => m.Id));
    }
}
