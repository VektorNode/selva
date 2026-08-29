using System;
using System.IO;
using Newtonsoft.Json;
using Selva.Slva;

namespace Selva.Tests;

/// <summary>
///     Writer → <see cref="BinaryGeometryReader" /> round-trips. This is the decoder behind the
///     Grasshopper viewport preview and <c>DisplayBatchTransformer</c>, and until these tests it was
///     the only one of the three SLVA decoders with no coverage: every other test in the suite runs
///     against <see cref="SlvaTestDecoder" />, a reimplementation, so a bug here reached the canvas
///     with all tests green.
///
///     Pairing it against the real writer is the point — two decoders written from the same spec by
///     the same hand agree on the same mistakes, which is what the cross-stack TS fixture test
///     exists to catch and what this one adds on the C# side.
/// </summary>
public class BinaryGeometryReaderTests
{
    /// <summary>Writes through the production writer, then reads back through the production reader.</summary>
    private static BinaryGeometryReader.Result RoundTrip(
        float[] vertices, int[] indices, string metadataJson = "{}",
        bool forceFloat32 = false, float[] uvs = null, byte[] colors = null,
        bool compress = false)
    {
        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, metadataJson, vertices, indices, forceFloat32, uvs, colors);
        var blob = ms.ToArray();
        return BinaryGeometryReader.Read(compress ? BlobCompressor.Compress(blob) : blob);
    }

    private static void AssertVerticesMatch(float[] expected, float[] actual, float tolerance)
    {
        Assert.Equal(expected.Length, actual.Length);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.InRange(actual[i] - expected[i], -tolerance, tolerance);
        }
    }

    // ========================================================================
    // Layout coverage
    // ========================================================================
    //
    // The writer picks planar or interleaved per blob by measuring, so the reader must handle both.
    // Only the planar branch is new in v4, and it is the one no test reached before.

    /// <summary>
    ///     Welded grid, sized past the writer's 4096-vertex probe threshold so the layout is chosen
    ///     by measurement rather than defaulted. Locally-coherent, so the probe lands on planar.
    /// </summary>
    private static (float[] vertices, int[] indices) CoherentGrid(int size)
    {
        var vertices = new float[size * size * 3];
        for (var y = 0; y < size; y++)
        {
            for (var x = 0; x < size; x++)
            {
                var i = (y * size + x) * 3;
                vertices[i] = x * 0.05f;
                vertices[i + 1] = y * 0.05f;
                vertices[i + 2] = ((x * 7 + y * 13) % 23) * 0.01f;
            }
        }

        var indices = new int[(size - 1) * (size - 1) * 6];
        var k = 0;
        for (var y = 0; y < size - 1; y++)
        {
            for (var x = 0; x < size - 1; x++)
            {
                var a = y * size + x;
                indices[k++] = a;
                indices[k++] = a + 1;
                indices[k++] = a + size;
                indices[k++] = a + 1;
                indices[k++] = a + size + 1;
                indices[k++] = a + size;
            }
        }

        return (vertices, indices);
    }

    [Fact]
    public void Read_DecodesThePlanarLayout_WithUint16Indices()
    {
        var (vertices, indices) = CoherentGrid(64);

        using var ms = new MemoryStream();
        var written = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);
        Assert.True(written.UsedPlanarByteSplit, "expected the probe to pick planar for a welded grid");
        Assert.True(written.UsedUint16Indices);

        var decoded = BinaryGeometryReader.Read(ms.ToArray());

        AssertVerticesMatch(vertices, decoded.Vertices, 0.001f);
        Assert.Equal(indices, decoded.Indices);
    }

    [Fact]
    public void Read_DecodesThePlanarLayout_WithUint32Indices()
    {
        // Past 65536 vertices the index stream widens to four byte planes — a separate read path
        // from the two-plane uint16 case above.
        var (vertices, indices) = CoherentGrid(300);
        Assert.True(vertices.Length / 3 > 65536);

        // A back-and-forth jump across the whole range, so the zigzag delta between consecutive
        // indices lands in the top byte plane. Sequential grid indices keep every delta small,
        // which leaves the high plane all zeros and a mis-shifted read indistinguishable from a
        // correct one.
        var vertexCount = vertices.Length / 3;
        indices[0] = 0;
        indices[1] = vertexCount - 1;
        indices[2] = 1;

        using var ms = new MemoryStream();
        var written = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);
        Assert.False(written.UsedUint16Indices);

        var decoded = BinaryGeometryReader.Read(ms.ToArray());

        AssertVerticesMatch(vertices, decoded.Vertices, 0.001f);
        Assert.Equal(indices, decoded.Indices);
    }

    [Fact]
    public void Read_DecodesTheInterleavedLayout()
    {
        // Eight-vertex boxes, the regime where the probe rejects planar (small parts favour
        // interleaved), so this pins the reader's other branch.
        const int count = 2000;
        var vertices = new float[count * 8 * 3];
        var indices = new int[count * 12 * 3];
        var vi = 0;
        var ii = 0;
        var state = 4242u;
        for (var b = 0; b < count; b++)
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            var cx = state % 80u * 5f;
            var baseIndex = vi / 3;
            for (var corner = 0; corner < 8; corner++)
            {
                vertices[vi++] = cx + (corner & 1);
                vertices[vi++] = (corner >> 1) & 1;
                vertices[vi++] = (corner >> 2) & 1;
            }

            for (var t = 0; t < 12; t++)
            {
                indices[ii++] = baseIndex + t % 8;
                indices[ii++] = baseIndex + (t + 1) % 8;
                indices[ii++] = baseIndex + (t + 2) % 8;
            }
        }

        using var ms = new MemoryStream();
        var written = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);
        Assert.False(written.UsedPlanarByteSplit, "expected the probe to reject planar for repeated parts");

        var decoded = BinaryGeometryReader.Read(ms.ToArray());

        AssertVerticesMatch(vertices, decoded.Vertices, 0.05f);
        Assert.Equal(indices, decoded.Indices);
    }

    [Fact]
    public void Read_DecodesFloat32Vertices()
    {
        // A 100 km bbox drives the writer onto the unquantized, unfiltered path.
        var vertices = new float[] { 0, 0, 0, 100000, 0, 0, 100000, 100000, 0, 0, 100000, 100000 };
        var indices = new[] { 0, 1, 2, 0, 2, 3 };

        var decoded = RoundTrip(vertices, indices);

        Assert.Equal(vertices, decoded.Vertices);
        Assert.Equal(indices, decoded.Indices);
    }

    // ========================================================================
    // Trailing chunks
    // ========================================================================

    [Fact]
    public void Read_DequantizesUvsAndRoundtripsColors()
    {
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0 };
        var indices = new[] { 0, 1, 2, 0, 2, 3 };
        var uvs = new[] { 0f, 0f, 1f, 0f, 1f, 1f, 0f, 1f };
        var colors = new byte[] { 255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128 };

        var decoded = RoundTrip(vertices, indices, uvs: uvs, colors: colors);

        Assert.NotNull(decoded.Uvs);
        for (var i = 0; i < uvs.Length; i++)
        {
            Assert.InRange(decoded.Uvs[i] - uvs[i], -0.0001f, 0.0001f);
        }

        // Colors are 8-bit with no quantization step, so the delta filter must be exactly lossless.
        Assert.Equal(colors, decoded.Colors);
    }

    [Fact]
    public void Read_ReturnsNullChunksWhenTheBlobCarriesNone()
    {
        // The flags gate the trailing reads. Mis-reading an absent chunk would consume the bytes
        // that aren't there rather than reporting "no channel".
        var decoded = RoundTrip(
            new float[] { 0, 0, 0, 1, 1, 1, 2, 0, 2 }, new[] { 0, 1, 2 });

        Assert.Null(decoded.Uvs);
        Assert.Null(decoded.Colors);
    }

    [Fact]
    public void Read_DecodesHeavilyTiledUvsThroughTheFloat32Fallback()
    {
        // UVs spanning ~100 tile repeats exceed the quantization step, so the chunk goes raw and
        // the reader must switch on uvFormat rather than the blob-wide float32 flag.
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0 };
        var indices = new[] { 0, 1, 2, 0, 2, 3 };
        var uvs = new[] { 0f, 0f, 100f, 0f, 100f, 100f, 0f, 100f };

        using var ms = new MemoryStream();
        var written = BinaryGeometryWriter.Write(ms, "{}", vertices, indices, uvs: uvs);
        Assert.True(written.UsedFloat32Uvs);

        var decoded = BinaryGeometryReader.Read(ms.ToArray());

        Assert.Equal(uvs, decoded.Uvs);
    }

    // ========================================================================
    // Envelope
    // ========================================================================

    [Fact]
    public void Read_InflatesAnSlvzContainer()
    {
        // WebDisplayPreview hands over whatever the param holds, which may be compressed. Detection
        // is by leading magic, so an uncompressed blob must also pass straight through.
        var (vertices, indices) = CoherentGrid(64);

        var compressed = RoundTrip(vertices, indices, compress: true);
        var plain = RoundTrip(vertices, indices);

        Assert.Equal(plain.Vertices, compressed.Vertices);
        Assert.Equal(plain.Indices, compressed.Indices);
    }

    [Fact]
    public void Read_DeserializesTheMetadataEnvelope()
    {
        // The preview reads Groups off this to slice the combined arrays back into per-mesh
        // geometry; losing it would draw nothing while the vertex data decoded fine.
        var batch = new DisplayBatch
        {
            BatchId = "component-42",
            Materials = new System.Collections.Generic.List<SerializableMaterial>
            {
                new SerializableMaterial { Color = "#FF0000", Opacity = 1.0 }
            },
            Groups = new System.Collections.Generic.List<MaterialGroup>
            {
                new MaterialGroup
                {
                    MaterialId = 0,
                    Meshes = new System.Collections.Generic.List<MeshMetadata>
                    {
                        new MeshMetadata
                        {
                            Name = "wall", Layer = "Structure/Walls",
                            VertexCount = 3, IndexCount = 3, VertexStart = 0, IndexStart = 0
                        }
                    }
                }
            }
        };

        var decoded = RoundTrip(
            new float[] { 0, 0, 0, 1, 1, 1, 2, 0, 2 }, new[] { 0, 1, 2 },
            JsonConvert.SerializeObject(batch));

        Assert.Equal("component-42", decoded.Metadata.BatchId);
        Assert.Equal("#FF0000", decoded.Metadata.Materials[0].Color);
        var mesh = decoded.Metadata.Groups[0].Meshes[0];
        Assert.Equal("wall", mesh.Name);
        Assert.Equal("Structure/Walls", mesh.Layer);
    }

    [Fact]
    public void Read_RejectsANonSlvaBlob()
    {
        // WebDisplayPreview catches this to draw nothing rather than break the canvas, so it has to
        // be a throw and not a silently empty result.
        Assert.Throws<InvalidDataException>(() =>
            BinaryGeometryReader.Read(new byte[] { 0xDE, 0xAD, 0xBE, 0xEF, 0, 0, 0, 0, 0, 0, 0, 0 }));
    }

    [Fact]
    public void Read_RejectsNullInput()
    {
        Assert.Throws<ArgumentNullException>(() => BinaryGeometryReader.Read(null!));
    }

    [Fact]
    public void Read_ReQuantizationIsIdempotent()
    {
        // DisplayBatchTransformer moves a baked batch by decoding, transforming, and re-encoding,
        // so a Move fed into a Move re-quantizes an already-quantized vertex. If each pass added
        // error, stacked transforms on the canvas would visibly drift. They don't: the grid is a
        // fixed point, so error stays at the one-time snap and never accumulates.
        var vertices = new float[3000];
        var random = new Random(7);
        for (var i = 0; i < vertices.Length; i++)
        {
            vertices[i] = (float)(random.NextDouble() * 10.0);
        }

        var indices = new int[999];
        for (var i = 0; i < indices.Length; i++)
        {
            indices[i] = i;
        }

        var first = RoundTrip(vertices, indices).Vertices;

        var current = first;
        for (var round = 0; round < 10; round++)
        {
            current = RoundTrip(current, indices).Vertices;
        }

        // Bit-exact against the first pass, not merely within tolerance.
        Assert.Equal(first, current);
    }

    [Fact]
    public void Read_ThrowsOnATruncatedBlobRatherThanReturningPartialGeometry()
    {
        // Both callers catch and degrade (blank preview / untransformed blob), which only works if
        // a short read raises instead of yielding half a mesh. A header can declare any
        // vertexCount; nothing bounds it against the bytes that actually follow.
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write(BinaryGeometryWriter.Magic);
        w.Write(BinaryGeometryWriter.Version);
        var meta = System.Text.Encoding.UTF8.GetBytes("{}");
        w.Write((uint)meta.Length);
        w.Write(meta);
        w.Write(BinaryGeometryWriter.FlagDeltaEncoded | BinaryGeometryWriter.FlagUint16Indices);
        w.Write(0.0); w.Write(0.0); w.Write(0.0);
        w.Write(1.0); w.Write(1.0); w.Write(1.0);
        w.Write(1_000_000u); // declares a million vertices; no vertex data follows
        w.Flush();

        Assert.ThrowsAny<Exception>(() => BinaryGeometryReader.Read(ms.ToArray()));
    }

    [Fact]
    public void Read_HandlesAnEmptyBatch()
    {
        // Items-only batches (curves/points, no meshes) still carry a well-formed blob with
        // vertexCount 0; the preview decodes it and draws no meshes.
        var decoded = RoundTrip(new float[0], new int[0]);

        Assert.Empty(decoded.Vertices);
        Assert.Empty(decoded.Indices);
    }
}
