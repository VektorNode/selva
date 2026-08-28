using System.Collections.Generic;
using System.Drawing;
using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

/// <summary>
///     The offsets this pass computes are the ones both decoders slice on, and every one of its
///     failure modes is silent: a wrong <c>VertexStart</c> renders another mesh's vertices, a
///     missed index rebase points into the wrong part of the combined array, and a group boundary
///     off by one assigns the wrong material. Nothing throws — the scene just comes out wrong.
///
///     These check the metadata against the combined arrays it describes, which is exactly the
///     consistency <c>validateGroupMetadata</c> assumes on the web side.
/// </summary>
public class MeshBatchAssemblerTests
{
    private static ThreeMaterial Material(Color color)
    {
        var m = ThreeMaterial.Default();
        m.Color = color;
        return m;
    }

    /// <summary>A quad at <paramref name="x" />: 4 vertices, 2 triangles, mesh-local indices.</summary>
    private static (float[] vertices, int[] faces) Quad(float x)
    {
        var vertices = new[]
        {
            x, 0f, 0f,
            x + 1f, 0f, 0f,
            x + 1f, 1f, 0f,
            x, 1f, 0f
        };
        return (vertices, new[] { 0, 1, 2, 0, 2, 3 });
    }

    private static DisplayBatch Build(
        List<float[]> verts, List<int[]> faces, List<ThreeMaterial> materials,
        List<string> names = null, List<string> layers = null,
        List<float[]> uvs = null, List<byte[]> colors = null)
    {
        names ??= verts.ConvertAll(_ => "mesh");
        return MeshBatchAssembler.CreateBatch(
            verts, faces, names, materials, metadataList: null, layers: layers,
            batchId: "component-1", uvArrays: uvs, colorArrays: colors);
    }

    // ========================================================================
    // Offsets and index rebasing
    // ========================================================================

    [Fact]
    public void CreateBatch_RebasesIndicesOntoTheCombinedVertexArray()
    {
        // Each quad arrives with local indices 0..3. Concatenated, the second must be shifted by
        // the first's vertex count or it would draw the first quad twice.
        var (v0, f0) = Quad(0f);
        var (v1, f1) = Quad(10f);
        var mat = Material(Color.Red);

        var batch = Build(
            new List<float[]> { v0, v1 },
            new List<int[]> { f0, f1 },
            new List<ThreeMaterial> { mat, mat });

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);

        Assert.Equal(8, decoded.Vertices.Length / 3);
        Assert.Equal(new[] { 0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7 }, decoded.Indices);
    }

    [Fact]
    public void CreateBatch_MetadataWindowsAddressEachMeshsOwnVertices()
    {
        // The contract the parsers rely on: slicing [vertexStart, +vertexCount) yields exactly the
        // mesh that was handed in, and its indices fall inside that window.
        var (v0, f0) = Quad(0f);
        var (v1, f1) = Quad(10f);
        var (v2, f2) = Quad(20f);
        var mat = Material(Color.Red);

        var batch = Build(
            new List<float[]> { v0, v1, v2 },
            new List<int[]> { f0, f1, f2 },
            new List<ThreeMaterial> { mat, mat, mat });

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);
        var meshes = batch.Groups[0].Meshes;
        var expectedX = new[] { 0f, 10f, 20f };

        for (var m = 0; m < meshes.Count; m++)
        {
            var meta = meshes[m];
            Assert.Equal(4, meta.VertexCount);
            Assert.Equal(6, meta.IndexCount);

            // First vertex of the window is that quad's origin corner.
            Assert.Equal(expectedX[m], decoded.Vertices[meta.VertexStart * 3], 3);

            for (var i = 0; i < meta.IndexCount; i++)
            {
                var index = decoded.Indices[meta.IndexStart + i];
                Assert.InRange(index, meta.VertexStart, meta.VertexStart + meta.VertexCount - 1);
            }
        }
    }

    [Fact]
    public void CreateBatch_SkipsNullSlotsWithoutShiftingLaterOffsets()
    {
        // A null slot marks a mesh that failed to convert. It must vanish entirely — if it
        // consumed an offset, every later mesh's window would point one mesh too far along.
        var (v0, f0) = Quad(0f);
        var (v2, f2) = Quad(20f);
        var mat = Material(Color.Red);

        var batch = Build(
            new List<float[]> { v0, null, v2 },
            new List<int[]> { f0, null, f2 },
            new List<ThreeMaterial> { mat, mat, mat },
            names: new List<string> { "a", "dropped", "c" });

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);
        var meshes = batch.Groups[0].Meshes;

        Assert.Equal(2, meshes.Count);
        Assert.Equal(8, decoded.Vertices.Length / 3);
        Assert.DoesNotContain(meshes, m => m.Name == "dropped");
        Assert.Equal(0, meshes[0].VertexStart);
        Assert.Equal(4, meshes[1].VertexStart);
        Assert.Equal(20f, decoded.Vertices[meshes[1].VertexStart * 3], 3);
    }

    // ========================================================================
    // Material grouping
    // ========================================================================

    [Fact]
    public void CreateBatch_GroupsByMaterialAndDedupesIdenticalOnes()
    {
        // Meshes arrive interleaved by material; grouping must gather them without losing the
        // originalIndex that ties each back to its GH input slot.
        var red = Material(Color.Red);
        var blue = Material(Color.Blue);
        var redAgain = Material(Color.Red); // distinct instance, identical values

        var quads = new List<float[]>();
        var faces = new List<int[]>();
        for (var i = 0; i < 4; i++)
        {
            var (v, f) = Quad(i * 10f);
            quads.Add(v);
            faces.Add(f);
        }

        var batch = Build(quads, faces, new List<ThreeMaterial> { red, blue, redAgain, blue });

        // Two unique materials despite three red/blue instances.
        Assert.Equal(2, batch.Materials.Count);
        Assert.Equal(2, batch.Groups.Count);

        var redGroup = batch.Groups.Find(g => g.MaterialId == 0);
        var blueGroup = batch.Groups.Find(g => g.MaterialId == 1);
        Assert.Equal(new[] { 0, 2 }, redGroup.Meshes.ConvertAll(m => m.OriginalIndex).ToArray());
        Assert.Equal(new[] { 1, 3 }, blueGroup.Meshes.ConvertAll(m => m.OriginalIndex).ToArray());
    }

    [Fact]
    public void CreateBatch_OrdersMeshesDeterministicallyWithinAMaterial()
    {
        // List.Sort is unstable, so the comparer breaks ties on OriginalIndex. Without that, two
        // runs over identical input could emit different byte streams — which would also defeat
        // the blob cache.
        var mat = Material(Color.Red);
        var quads = new List<float[]>();
        var faces = new List<int[]>();
        for (var i = 0; i < 40; i++)
        {
            var (v, f) = Quad(i);
            quads.Add(v);
            faces.Add(f);
        }

        var materials = quads.ConvertAll(_ => mat);
        var first = Build(quads, faces, materials);
        var second = Build(quads, faces, materials);

        Assert.Equal(first.CompressedData, second.CompressedData);

        var order = first.Groups[0].Meshes.ConvertAll(m => m.OriginalIndex);
        for (var i = 0; i < order.Count; i++)
        {
            Assert.Equal(i, order[i]);
        }
    }

    // ========================================================================
    // Optional channels
    // ========================================================================

    [Fact]
    public void CreateBatch_NeutralFillsMeshesMissingAChannelTheBatchCarries()
    {
        // If any mesh has colors the whole batch carries them, and meshes without get white —
        // which multiplies to identity in the shader. Black (the byte default) would render those
        // meshes invisible, so the explicit fill is load-bearing.
        var (v0, f0) = Quad(0f);
        var (v1, f1) = Quad(10f);
        var mat = Material(Color.Red);

        var batch = Build(
            new List<float[]> { v0, v1 },
            new List<int[]> { f0, f1 },
            new List<ThreeMaterial> { mat, mat },
            colors: new List<byte[]>
            {
                new byte[] { 10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30 },
                null
            });

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);

        Assert.NotNull(decoded.Colors);
        Assert.Equal(new byte[] { 10, 20, 30 }, decoded.Colors[..3]);
        // Second quad's four vertices are all white.
        for (var i = 12; i < 24; i++)
        {
            Assert.Equal(255, decoded.Colors[i]);
        }
    }

    [Fact]
    public void CreateBatch_OmitsChannelsEntirelyWhenNoMeshCarriesThem()
    {
        // The zero-cost guarantee: a plain batch must not gain a UV/color chunk, or every
        // untextured scene pays for one.
        var (v0, f0) = Quad(0f);

        var batch = Build(
            new List<float[]> { v0 },
            new List<int[]> { f0 },
            new List<ThreeMaterial> { Material(Color.Red) });

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);

        Assert.Null(decoded.Uvs);
        Assert.Null(decoded.Colors);
    }

    [Fact]
    public void CreateBatch_PlacesEachMeshsUvsAtItsOwnVertexOffset()
    {
        // UVs are indexed by vertex (times 2), not by component. Using the component offset would
        // land the second mesh's UVs at the wrong stride and smear its texture.
        var (v0, f0) = Quad(0f);
        var (v1, f1) = Quad(10f);
        var mat = Material(Color.Red);

        var batch = Build(
            new List<float[]> { v0, v1 },
            new List<int[]> { f0, f1 },
            new List<ThreeMaterial> { mat, mat },
            uvs: new List<float[]>
            {
                new[] { 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f },
                new[] { 1f, 1f, 1f, 1f, 1f, 1f, 1f, 1f }
            });

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);
        var second = batch.Groups[0].Meshes[1];

        Assert.Equal(0f, decoded.Uvs[0], 3);
        Assert.Equal(1f, decoded.Uvs[second.VertexStart * 2], 3);
    }

    // ========================================================================
    // Degenerate input
    // ========================================================================

    [Fact]
    public void CreateBatch_ProducesAValidEmptyBlobForAnItemsOnlyBatch()
    {
        // A curves-only branch still needs a well-formed blob so neither decoder needs an
        // "is there geometry?" branch.
        var batch = MeshBatchAssembler.CreateBatch(
            new List<float[]>(), new List<int[]>(), new List<string>(),
            new List<ThreeMaterial>(), batchId: "component-1");

        Assert.NotNull(batch.CompressedData);

        var decoded = BinaryGeometryReader.Read(batch.CompressedData);
        Assert.Empty(decoded.Vertices);
        Assert.Empty(decoded.Indices);
    }

    [Fact]
    public void CreateBatch_RejectsMismatchedParallelLists()
    {
        // The lists are positional; a length mismatch means a caller lost alignment and would
        // otherwise attach the wrong name/material to every mesh past that point.
        var (v0, f0) = Quad(0f);

        Assert.Throws<System.ArgumentException>(() => MeshBatchAssembler.CreateBatch(
            new List<float[]> { v0 },
            new List<int[]> { f0 },
            new List<string> { "a", "b" },
            new List<ThreeMaterial> { Material(Color.Red) }));
    }
}
