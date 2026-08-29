using System;
using System.IO;
using System.Text;
using Selva.Slva;

namespace Selva.Slva.Tests;

public class BinaryGeometryWriterTests
{
    private const uint ExpectedMagic = 0x41564C53;
    private const uint ExpectedVersion = 4;

    [Fact]
    public void Write_EmitsMagicAndVersion()
    {
        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, "{}", new float[0], new int[0]);
        var bytes = ms.ToArray();

        using var br = new BinaryReader(new MemoryStream(bytes));
        Assert.Equal(ExpectedMagic, br.ReadUInt32());
        Assert.Equal(ExpectedVersion, br.ReadUInt32());
    }

    [Fact]
    public void Write_RoundtripsMetadataJson()
    {
        const string metadata = "{\"materials\":[],\"groups\":[],\"sourceComponentId\":\"abc\"}";

        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, metadata, new float[0], new int[0]);

        using var br = new BinaryReader(new MemoryStream(ms.ToArray()));
        br.ReadUInt32();
        br.ReadUInt32();
        var len = br.ReadUInt32();
        var roundtripped = Encoding.UTF8.GetString(br.ReadBytes((int)len));

        Assert.Equal(metadata, roundtripped);
    }

    [Fact]
    public void Write_QuantizesAndRoundtripsWithinPrecision()
    {
        // Cube from (0,0,0) to (10,10,10) — 10m bbox, int16 step ~0.15mm.
        var vertices = new float[]
        {
            0, 0, 0,
            10, 0, 0,
            10, 10, 0,
            0, 10, 0,
            0, 0, 10,
            10, 0, 10,
            10, 10, 10,
            0, 10, 10,
        };
        var indices = new int[] { 0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7 };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        Assert.False(result.UsedFloat32);
        Assert.True(result.UsedUint16Indices);
        Assert.Equal(8, result.VertexCount);
        Assert.Equal(12, result.IndexCount);

        var (decodedVerts, decodedIndices, flags) = ReadGeometry(ms.ToArray());
        // Below the layout-probe threshold the writer takes planar unconditionally.
        Assert.Equal(
            BinaryGeometryWriter.FlagUint16Indices | BinaryGeometryWriter.FlagDeltaEncoded
            | BinaryGeometryWriter.FlagPlanarByteSplit,
            flags);

        for (var i = 0; i < vertices.Length; i++)
        {
            Assert.InRange(decodedVerts[i] - vertices[i], -0.001f, 0.001f);
        }

        Assert.Equal(indices.Length, decodedIndices.Length);
        for (var i = 0; i < indices.Length; i++)
        {
            Assert.Equal((uint)indices[i], decodedIndices[i]);
        }
    }

    [Fact]
    public void Write_HandlesPlanarSceneWithZeroExtentAxis()
    {
        // All Z = 0. ScaleZ should clamp to epsilon, all qz = 0, no NaN.
        var vertices = new float[]
        {
            0, 0, 0,
            5, 0, 0,
            5, 5, 0,
            0, 5, 0,
        };
        var indices = new int[] { 0, 1, 2, 0, 2, 3 };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        var (decodedVerts, _, _) = ReadGeometry(ms.ToArray());
        for (var i = 2; i < decodedVerts.Length; i += 3)
        {
            Assert.Equal(0.0f, decodedVerts[i]);
        }

        Assert.False(double.IsNaN(result.ScaleZ));
        Assert.True(result.ScaleZ > 0);
    }

    [Fact]
    public void Write_FallsBackToFloat32ForExtremeBbox()
    {
        // 100km bbox => int16 step ~1.5m, way over the 5cm threshold => float32 path.
        var vertices = new float[]
        {
            0, 0, 0,
            100000, 0, 0,
            100000, 100000, 0,
            0, 100000, 100000,
        };
        var indices = new int[] { 0, 1, 2, 0, 2, 3 };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        Assert.True(result.UsedFloat32);

        var (decoded, _, flags) = ReadGeometry(ms.ToArray());
        Assert.Equal(BinaryGeometryWriter.FlagFloat32, flags & BinaryGeometryWriter.FlagFloat32);

        // Float32 path is exact for the supplied values (they fit in float32 exactly).
        for (var i = 0; i < vertices.Length; i++)
        {
            Assert.Equal(vertices[i], decoded[i]);
        }
    }

    [Fact]
    public void Write_ForceFloat32_BypassesQuantization()
    {
        var vertices = new float[] { 0, 0, 0, 1, 2, 3 };
        var indices = new int[] { 0, 1 };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices, forceFloat32: true);

        Assert.True(result.UsedFloat32);

        var (decoded, decodedIdx, _) = ReadGeometry(ms.ToArray());
        Assert.Equal(vertices, decoded);
        Assert.Equal(indices.Length, decodedIdx.Length);
    }

    [Fact]
    public void Write_RejectsNonMultipleOfThreeVertices()
    {
        using var ms = new MemoryStream();
        Assert.Throws<ArgumentException>(() =>
            BinaryGeometryWriter.Write(ms, "{}", new float[] { 1, 2 }, new int[0]));
    }

    [Fact]
    public void Write_RejectsNullArguments()
    {
        using var ms = new MemoryStream();
        Assert.Throws<ArgumentNullException>(() =>
            BinaryGeometryWriter.Write(null!, "{}", new float[0], new int[0]));
        Assert.Throws<ArgumentNullException>(() =>
            BinaryGeometryWriter.Write(ms, null!, new float[0], new int[0]));
        Assert.Throws<ArgumentNullException>(() =>
            BinaryGeometryWriter.Write(ms, "{}", null!, new int[0]));
        Assert.Throws<ArgumentNullException>(() =>
            BinaryGeometryWriter.Write(ms, "{}", new float[0], null!));
    }

    [Fact]
    public void Write_UsesUint32IndicesWhenBatchExceedsUint16()
    {
        // 65537 vertices forces uint32 indices. Tiny bbox keeps int16 verts in play.
        const int vertexCount = 65537;
        var vertices = new float[vertexCount * 3];
        for (var v = 0; v < vertexCount; v++)
        {
            vertices[v * 3] = (v % 100) * 0.001f;
        }

        var indices = new[] { 0, 1, 65536 };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        Assert.False(result.UsedUint16Indices);

        var (_, decodedIndices, flags) = ReadGeometry(ms.ToArray());
        Assert.Equal(0u, flags & BinaryGeometryWriter.FlagUint16Indices);
        Assert.Equal(new uint[] { 0, 1, 65536 }, decodedIndices);
    }

    [Fact]
    public void Write_DeltaFilterRoundtripsExtremeQuantizedJumps()
    {
        // X alternates across the full bbox, so quantized values swing between -32767 and +32767 and
        // per-component deltas (±65534) exceed int16 — exercising the wrapping arithmetic. Index
        // jumps are similarly non-local.
        var vertices = new float[]
        {
            0, 0, 0,
            10, 10, 10,
            0, 0, 0,
            10, 0, 10,
        };
        var indices = new int[] { 0, 3, 1, 3, 0, 2 };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        Assert.False(result.UsedFloat32);

        var (decodedVerts, decodedIndices, flags) = ReadGeometry(ms.ToArray());
        Assert.Equal(BinaryGeometryWriter.FlagDeltaEncoded, flags & BinaryGeometryWriter.FlagDeltaEncoded);

        for (var i = 0; i < vertices.Length; i++)
        {
            Assert.InRange(decodedVerts[i] - vertices[i], -0.001f, 0.001f);
        }

        for (var i = 0; i < indices.Length; i++)
        {
            Assert.Equal((uint)indices[i], decodedIndices[i]);
        }
    }

    [Fact]
    public void Write_WithoutUvsOrColors_EmitsNoChunkFlagsAndNoTrailingBytes()
    {
        // The zero-cost guarantee: a chunk-less write sets neither chunk flag and appends nothing
        // after the index block, so plain meshes are byte-identical to pre-chunk blobs.
        var vertices = new float[] { 0, 0, 0, 1, 1, 1, 2, 0, 2 };
        var indices = new int[] { 0, 1, 2 };

        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        var decoded = ReadAll(ms.ToArray());
        Assert.Equal(0u, decoded.Flags & BinaryGeometryWriter.FlagHasUvs);
        Assert.Equal(0u, decoded.Flags & BinaryGeometryWriter.FlagHasVertexColors);
        Assert.Null(decoded.Uvs);
        Assert.Null(decoded.Colors);
        Assert.Equal(ms.Length, decoded.BytesConsumed);
    }

    [Fact]
    public void Write_QuantizedUvs_RoundtripWithinPrecision()
    {
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0 };
        var indices = new int[] { 0, 1, 2, 0, 2, 3 };
        var uvs = new float[] { 0f, 0f, 1f, 0f, 1f, 1f, 0f, 1f };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices, uvs: uvs);

        Assert.False(result.UsedFloat32Uvs);

        var decoded = ReadAll(ms.ToArray());
        Assert.Equal(BinaryGeometryWriter.FlagHasUvs, decoded.Flags & BinaryGeometryWriter.FlagHasUvs);
        Assert.NotNull(decoded.Uvs);
        for (var i = 0; i < uvs.Length; i++)
        {
            // Quantization error bound: extent / 65535.
            Assert.InRange(decoded.Uvs![i] - uvs[i], -0.0001f, 0.0001f);
        }

        Assert.Equal(ms.Length, decoded.BytesConsumed);
    }

    [Fact]
    public void Write_ConstantUvs_SurviveDegenerateExtent()
    {
        // Zero extent on both axes: scale clamps to epsilon, all q = 0, uv = origin exactly.
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0 };
        var indices = new int[] { 0, 1, 2 };
        var uvs = new float[] { 0.25f, 0.75f, 0.25f, 0.75f, 0.25f, 0.75f };

        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, "{}", vertices, indices, uvs: uvs);

        var decoded = ReadAll(ms.ToArray());
        for (var i = 0; i < uvs.Length; i++)
        {
            Assert.InRange(decoded.Uvs![i] - uvs[i], -0.0001f, 0.0001f);
        }
    }

    [Fact]
    public void Write_HeavilyTiledUvs_FallBackToFloat32()
    {
        // Extent 100 => step 100/65535 ≈ 0.0015 > 1/4096 => float32 UVs, exact roundtrip.
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0 };
        var indices = new int[] { 0, 1, 2 };
        var uvs = new float[] { 0f, 0f, 100f, 0f, 100f, 100f };

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices, uvs: uvs);

        Assert.True(result.UsedFloat32Uvs);

        var decoded = ReadAll(ms.ToArray());
        Assert.Equal(uvs, decoded.Uvs);
    }

    [Fact]
    public void Write_VertexColors_RoundtripExactlyIncludingWrappingDeltas()
    {
        // Full-range jumps (0 → 255 → 1) exercise the wrapped 8-bit delta arithmetic.
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0 };
        var indices = new int[] { 0, 1, 2 };
        var colors = new byte[] { 0, 255, 128, 255, 0, 1, 1, 254, 255 };

        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, "{}", vertices, indices, colors: colors);

        var decoded = ReadAll(ms.ToArray());
        Assert.Equal(BinaryGeometryWriter.FlagHasVertexColors,
            decoded.Flags & BinaryGeometryWriter.FlagHasVertexColors);
        Assert.Equal(colors, decoded.Colors);
        Assert.Null(decoded.Uvs);
        Assert.Equal(ms.Length, decoded.BytesConsumed);
    }

    [Fact]
    public void Write_BothChunks_DecodeInUvThenColorOrder()
    {
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0 };
        var indices = new int[] { 0, 1, 2 };
        var uvs = new float[] { 0f, 0f, 0.5f, 0f, 0.5f, 0.5f };
        var colors = new byte[] { 10, 20, 30, 40, 50, 60, 70, 80, 90 };

        using var ms = new MemoryStream();
        BinaryGeometryWriter.Write(ms, "{}", vertices, indices, uvs: uvs, colors: colors);

        var decoded = ReadAll(ms.ToArray());
        Assert.NotNull(decoded.Uvs);
        Assert.Equal(colors, decoded.Colors);
        for (var i = 0; i < uvs.Length; i++)
        {
            Assert.InRange(decoded.Uvs![i] - uvs[i], -0.0001f, 0.0001f);
        }

        Assert.Equal(ms.Length, decoded.BytesConsumed);
    }

    [Fact]
    public void Write_RejectsMismatchedUvAndColorLengths()
    {
        var vertices = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0 };
        var indices = new int[] { 0, 1, 2 };

        using var ms = new MemoryStream();
        Assert.Throws<ArgumentException>(() =>
            BinaryGeometryWriter.Write(ms, "{}", vertices, indices, uvs: new float[] { 0, 0 }));
        Assert.Throws<ArgumentException>(() =>
            BinaryGeometryWriter.Write(ms, "{}", vertices, indices, colors: new byte[] { 1, 2, 3, 4 }));
    }

    // ========================================================================
    // Byte-layout selection (ChoosePlanarLayout)
    // ========================================================================
    //
    // Neither layout wins universally, so the writer measures both and keeps the smaller. These
    // pin both outcomes and — more importantly — that whichever it picks still round-trips.

    /// <summary>
    ///     Welded height-field grid: locally-coherent vertices, the case planar byte-split exists
    ///     for. Sized past the probe threshold so the measurement actually runs.
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

    /// <summary>
    ///     The same 24-vertex box translated onto a lattice many times. After the delta filter each
    ///     copy's bytes are identical, so interleaved keeps them contiguous for LZ77 to match.
    /// </summary>
    private static (float[] vertices, int[] indices) RepeatedParts(int count)
    {
        var vertices = new float[count * 24 * 3];
        var indices = new int[count * 12 * 3];
        var vertexCursor = 0;
        var indexCursor = 0;
        var state = 4242u;
        uint Next()
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            return state;
        }

        for (var b = 0; b < count; b++)
        {
            AppendUnitBox(vertices, indices, ref vertexCursor, ref indexCursor,
                Next() % 80u * 5f, Next() % 80u * 5f, Next() % 10u * 5f);
        }

        return (vertices, indices);
    }

    private static void AppendUnitBox(
        float[] vertices, int[] indices, ref int vertexCursor, ref int indexCursor,
        float cx, float cy, float cz)
    {
        int[][] faces =
        {
            new[] { 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0 },
            new[] { 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1 },
            new[] { 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1 },
            new[] { 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1 },
            new[] { 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1 },
            new[] { 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1 }
        };

        foreach (var face in faces)
        {
            var baseIndex = vertexCursor / 3;
            for (var c = 0; c < 4; c++)
            {
                vertices[vertexCursor++] = cx + face[c * 3] * 2f;
                vertices[vertexCursor++] = cy + face[c * 3 + 1] * 1.5f;
                vertices[vertexCursor++] = cz + face[c * 3 + 2] * 3f;
            }

            indices[indexCursor++] = baseIndex;
            indices[indexCursor++] = baseIndex + 1;
            indices[indexCursor++] = baseIndex + 2;
            indices[indexCursor++] = baseIndex;
            indices[indexCursor++] = baseIndex + 2;
            indices[indexCursor++] = baseIndex + 3;
        }
    }

    [Fact]
    public void Write_CoherentGeometry_PicksPlanarLayout()
    {
        var (vertices, indices) = CoherentGrid(128);

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        Assert.True(result.UsedPlanarByteSplit);

        var decoded = ReadAll(ms.ToArray());
        Assert.Equal(BinaryGeometryWriter.FlagPlanarByteSplit,
            decoded.Flags & BinaryGeometryWriter.FlagPlanarByteSplit);
        AssertRoundtrips(decoded, vertices, indices, tolerance: 0.001f);
    }

    [Fact]
    public void Write_RepeatedParts_PicksInterleavedLayout()
    {
        // Eight-vertex boxes: small enough that a copy's delta stream is too short to survive
        // planar's split across six planes, so the probe must land on interleaved here. Part size
        // is what decides this, not the repeat count — dense repeated parts go the other way.
        var (vertices, indices) = RepeatedParts(2000);

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

        Assert.False(result.UsedPlanarByteSplit);

        var decoded = ReadAll(ms.ToArray());
        Assert.Equal(0u, decoded.Flags & BinaryGeometryWriter.FlagPlanarByteSplit);
        Assert.Equal(BinaryGeometryWriter.FlagDeltaEncoded,
            decoded.Flags & BinaryGeometryWriter.FlagDeltaEncoded);
        AssertRoundtrips(decoded, vertices, indices, tolerance: 0.05f);
    }

    [Fact]
    public void Write_LayoutChoiceActuallyMinimizesTheDeflatedBlob()
    {
        // The contract the probe promises: whatever it picks is no larger than the alternative.
        // Checked on both regimes by re-encoding the blob into the other layout and comparing.
        foreach (var (label, mesh) in new[]
                 {
                     ("coherent grid", CoherentGrid(128)),
                     ("repeated parts", RepeatedParts(2000))
                 })
        {
            var (vertices, indices) = mesh;
            using var ms = new MemoryStream();
            var result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);

            var chosen = BlobCompressor.Compress(ms.ToArray());
            var alternative = BlobCompressor.Compress(
                SwapGeometryLayout(ms.ToArray(), result));

            Assert.True(chosen.Length <= alternative.Length,
                $"{label}: writer chose {(result.UsedPlanarByteSplit ? "planar" : "interleaved")} " +
                $"at {chosen.Length:N0} bytes, but the other layout deflates to {alternative.Length:N0}.");
        }
    }

    /// <summary>
    ///     Rewrites a blob's filtered geometry between the planar and interleaved layouts. Same
    ///     values and same length — only byte order moves — so the result is what the writer would
    ///     have emitted had the probe gone the other way.
    /// </summary>
    private static byte[] SwapGeometryLayout(byte[] blob, BinaryGeometryWriter.WriteResult result)
    {
        var swapped = (byte[])blob.Clone();
        var metadataLen = BitConverter.ToUInt32(blob, 8);
        var offset = 12 + (int)metadataLen + 4 + 48 + 4;
        var fromPlanar = result.UsedPlanarByteSplit;

        var n = result.VertexCount;
        for (var i = 0; i < n; i++)
        {
            // Plane order [Xlo][Ylo][Zlo][Xhi][Yhi][Zhi] vs interleaved xlo,xhi,ylo,yhi,zlo,zhi.
            int[] planar = { offset + i, offset + n + i, offset + n * 2 + i, offset + n * 3 + i, offset + n * 4 + i, offset + n * 5 + i };
            int[] interleaved = { offset + i * 6, offset + i * 6 + 2, offset + i * 6 + 4, offset + i * 6 + 1, offset + i * 6 + 3, offset + i * 6 + 5 };
            for (var c = 0; c < 6; c++)
            {
                if (fromPlanar)
                {
                    swapped[interleaved[c]] = blob[planar[c]];
                }
                else
                {
                    swapped[planar[c]] = blob[interleaved[c]];
                }
            }
        }

        offset += n * 6 + 4;
        var indexCount = result.IndexCount;
        var width = result.UsedUint16Indices ? 2 : 4;
        for (var i = 0; i < indexCount; i++)
        {
            for (var b = 0; b < width; b++)
            {
                if (fromPlanar)
                {
                    swapped[offset + i * width + b] = blob[offset + indexCount * b + i];
                }
                else
                {
                    swapped[offset + indexCount * b + i] = blob[offset + i * width + b];
                }
            }
        }

        return swapped;
    }

    private static void AssertRoundtrips(
        SlvaTestDecoder.DecodedBlob decoded, float[] vertices, int[] indices, float tolerance)
    {
        Assert.Equal(vertices.Length, decoded.Vertices.Length);
        for (var i = 0; i < vertices.Length; i++)
        {
            Assert.InRange(decoded.Vertices[i] - vertices[i], -tolerance, tolerance);
        }

        Assert.Equal(indices.Length, decoded.Indices.Length);
        for (var i = 0; i < indices.Length; i++)
        {
            Assert.Equal((uint)indices[i], decoded.Indices[i]);
        }
    }

    // ========================================================================
    // Parallel bbox pass (ComputeBoundsParallel)
    // ========================================================================
    //
    // The bbox becomes the quantization origin/scale, so a partitioned reduction that disagrees
    // with a serial scan by even one ULP shifts every vertex in the blob. These tests pin the
    // parallel path (engages past 200k components) to byte-identical output.

    /// <summary>
    ///     Deterministic pseudo-random vertex cloud, spread across a wide range so extremes land
    ///     in unpredictable partitions rather than at the array ends.
    /// </summary>
    private static float[] SyntheticCloud(int vertexCount, int seed = 12345)
    {
        var verts = new float[vertexCount * 3];
        var state = (uint)seed;
        for (var i = 0; i < verts.Length; i++)
        {
            // xorshift32
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            verts[i] = (state % 200000u) / 100.0f - 1000.0f;
        }

        return verts;
    }

    [Fact]
    public void Write_ParallelBoundsMatchesSerialBounds_ForLargeCloud()
    {
        // 90k vertices = 270k components, past the 200k parallel threshold.
        var large = SyntheticCloud(90_000);

        // Independently computed serial bbox to compare the parallel result against.
        double minX = large[0], minY = large[1], minZ = large[2];
        double maxX = large[0], maxY = large[1], maxZ = large[2];
        for (var i = 3; i < large.Length; i += 3)
        {
            minX = Math.Min(minX, large[i]);
            minY = Math.Min(minY, large[i + 1]);
            minZ = Math.Min(minZ, large[i + 2]);
            maxX = Math.Max(maxX, large[i]);
            maxY = Math.Max(maxY, large[i + 1]);
            maxZ = Math.Max(maxZ, large[i + 2]);
        }

        // The quantized path is where the bbox is observable: origin IS the bbox min.
        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", large, new int[0]);

        Assert.False(result.UsedFloat32, "bbox extent pushed the writer onto the float32 path");
        Assert.Equal(90_000, result.VertexCount);
        Assert.Equal(minX, result.OriginX, 6);
        Assert.Equal(minY, result.OriginY, 6);
        Assert.Equal(minZ, result.OriginZ, 6);
        Assert.Equal(Math.Max((maxX - minX) / 65534.0, 1e-12), result.ScaleX, 12);
        Assert.Equal(Math.Max((maxY - minY) / 65534.0, 1e-12), result.ScaleY, 12);
        Assert.Equal(Math.Max((maxZ - minZ) / 65534.0, 1e-12), result.ScaleZ, 12);
    }

    [Fact]
    public void Write_ParallelBoundsFindsExtremesInEveryPartition()
    {
        // Extremes planted deep inside the cloud, so a reduction that dropped a partition (or
        // seeded from the wrong element) misses them. Just past SyntheticCloud's own +/-1000
        // spread: far enough to be unambiguous, close enough that the 2500 extent keeps the int16
        // step under the 5 cm float32-fallback threshold. On the float32 path origin/scale are
        // identity and the assertions below would test nothing.
        var verts = SyntheticCloud(120_000);
        verts[3 * 7777] = -1500f;       // x min, early partition
        verts[3 * 61111 + 1] = -1400f;  // y min, middle partition
        verts[3 * 119_998 + 2] = 1300f; // z max, last partition

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", verts, new int[0]);

        Assert.False(result.UsedFloat32, "bbox extent pushed the writer onto the float32 path");
        Assert.Equal(-1500.0, result.OriginX, 3);
        Assert.Equal(-1400.0, result.OriginY, 3);

        var maxZ = result.OriginZ + result.ScaleZ * 65534.0;
        Assert.Equal(1300.0, maxZ, 2);
    }

    [Fact]
    public void Write_ParallelBoundsIsDeterministicAcrossRuns()
    {
        // Partition scheduling varies run to run; the emitted bytes must not.
        var verts = SyntheticCloud(150_000, seed: 999);
        var indices = new int[300];
        for (var i = 0; i < indices.Length; i++)
        {
            indices[i] = i;
        }

        using var first = new MemoryStream();
        BinaryGeometryWriter.Write(first, "{}", verts, indices);
        var expected = first.ToArray();

        for (var run = 0; run < 5; run++)
        {
            using var next = new MemoryStream();
            BinaryGeometryWriter.Write(next, "{}", verts, indices);
            Assert.Equal(expected, next.ToArray());
        }
    }

    [Fact]
    public void Write_ParallelBoundsHandlesUniformCloud()
    {
        // Every vertex identical: zero extent on all axes. The partitioned merge must not let an
        // empty-tail partition's infinity sentinels leak into the result.
        var verts = new float[80_000 * 3];
        for (var i = 0; i < verts.Length; i += 3)
        {
            verts[i] = 5f;
            verts[i + 1] = -3f;
            verts[i + 2] = 2f;
        }

        using var ms = new MemoryStream();
        var result = BinaryGeometryWriter.Write(ms, "{}", verts, new int[0]);

        Assert.Equal(5.0, result.OriginX, 6);
        Assert.Equal(-3.0, result.OriginY, 6);
        Assert.Equal(2.0, result.OriginZ, 6);
        Assert.False(double.IsInfinity(result.ScaleX));
        Assert.False(double.IsInfinity(result.ScaleY));
        Assert.False(double.IsInfinity(result.ScaleZ));

        // Degenerate axes collapse to the epsilon scale, and every quantized value to 0.
        var (decoded, _, _) = ReadGeometry(ms.ToArray());
        for (var i = 0; i < decoded.Length; i += 3)
        {
            Assert.Equal(5.0, decoded[i], 3);
            Assert.Equal(-3.0, decoded[i + 1], 3);
            Assert.Equal(2.0, decoded[i + 2], 3);
        }
    }

    /// <summary>
    ///     Decodes the binary blob the same way the JS parser will — see
    ///     <see cref="SlvaTestDecoder" /> for the flag-driven read path shared with the frozen
    ///     fixture tests.
    /// </summary>
    private static (float[] vertices, uint[] indices, uint flags) ReadGeometry(byte[] blob)
    {
        var decoded = SlvaTestDecoder.ReadAll(blob);
        return (decoded.Vertices, decoded.Indices, decoded.Flags);
    }

    private static SlvaTestDecoder.DecodedBlob ReadAll(byte[] blob)
    {
        var decoded = SlvaTestDecoder.ReadAll(blob);
        Assert.Equal(ExpectedVersion, decoded.Version);
        return decoded;
    }
}
