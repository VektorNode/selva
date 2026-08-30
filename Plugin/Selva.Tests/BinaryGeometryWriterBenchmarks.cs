using System;
using System.Buffers;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using Selva.GH.Features.Display.Services;
using Xunit.Abstractions;

namespace Selva.Tests;

// Compares BinaryGeometryWriter output against the old gzip(float32 + int32) format on synthetic
// meshes approximating real WebDisplay payloads. Run manually when validating performance changes.
public class BinaryGeometryWriterBenchmarks
{
    private readonly ITestOutputHelper _output;

    public BinaryGeometryWriterBenchmarks(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void Compare_SmallMesh()
    {
        Run("Small (10k vertices, 30k indices)", vertexCount: 10_000, indexCount: 30_000, bboxSize: 10f);
    }

    [Fact]
    public void Compare_MediumMesh()
    {
        Run("Medium (250k vertices, 750k indices)", vertexCount: 250_000, indexCount: 750_000, bboxSize: 50f);
    }

    [Fact]
    public void Compare_HeavyMesh()
    {
        Run("Heavy (1.5M vertices, 4.5M indices)", vertexCount: 1_500_000, indexCount: 4_500_000, bboxSize: 100f);
    }

    private void Run(string label, int vertexCount, int indexCount, float bboxSize)
    {
        var (vertices, indices) = GenerateMesh(vertexCount, indexCount, bboxSize);

        var oldSw = Stopwatch.StartNew();
        var oldBytes = WriteOldFormat(vertices, indices);
        oldSw.Stop();
        var oldBase64Len = Base64Length(oldBytes.Length);

        var newSw = Stopwatch.StartNew();
        byte[] newBytes;
        BinaryGeometryWriter.WriteResult result;
        using (var ms = new MemoryStream())
        {
            result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);
            newBytes = ms.ToArray();
        }
        newSw.Stop();
        var newBase64Len = Base64Length(newBytes.Length);

        var rawRatio = (double)newBytes.Length / oldBytes.Length;
        var wireRatio = (double)newBase64Len / oldBase64Len;
        var rawSavings = 1.0 - rawRatio;
        var wireSavings = 1.0 - wireRatio;

        _output.WriteLine($"=== {label} ===");
        _output.WriteLine($"Format selected     : {(result.UsedFloat32 ? "float32" : "int16")}");
        _output.WriteLine($"Old (gzip+f32+i32)  : {oldBytes.Length,12:N0} bytes raw  | {oldBase64Len,12:N0} bytes base64  | {oldSw.ElapsedMilliseconds,4} ms write");
        _output.WriteLine($"New (binary writer) : {newBytes.Length,12:N0} bytes raw  | {newBase64Len,12:N0} bytes base64  | {newSw.ElapsedMilliseconds,4} ms write");
        _output.WriteLine($"Raw size            : {rawRatio * 100:F1}% of old   ({rawSavings * 100:F1}% smaller)");
        _output.WriteLine($"Wire (post-base64)  : {wireRatio * 100:F1}% of old   ({wireSavings * 100:F1}% smaller)");
        _output.WriteLine("");

        // Sanity floor: never more than 10% larger than the gzip path, regardless of input shape.
        Assert.True(newBytes.Length < oldBytes.Length * 1.1,
            $"New format unexpectedly larger than old: new={newBytes.Length:N0}, old={oldBytes.Length:N0}");
    }

    /// <summary>Synthetic mesh, vertices uniformly distributed in a cube of side <paramref name="bboxSize"/>.</summary>
    private static (float[] vertices, int[] indices) GenerateMesh(int vertexCount, int indexCount, float bboxSize)
    {
        var rng = new Random(42); // fixed seed: benchmark runs must be repeatable
        var vertices = new float[vertexCount * 3];
        for (var i = 0; i < vertices.Length; i++)
        {
            vertices[i] = (float)(rng.NextDouble() * bboxSize);
        }

        var indices = new int[indexCount];
        for (var i = 0; i < indices.Length; i++)
        {
            indices[i] = rng.Next(vertexCount);
        }

        return (vertices, indices);
    }

    /// <summary>Replicates the old <c>CompressionHelper.CompressGeometryData</c> format exactly.</summary>
    private static byte[] WriteOldFormat(float[] vertices, int[] faces)
    {
        using var outputStream = new MemoryStream();
        using (var compressionStream = new GZipStream(outputStream, CompressionLevel.Fastest))
        using (var writer = new BinaryWriter(compressionStream))
        {
            writer.Write(vertices.Length);
            WriteFloatArray(compressionStream, vertices);
            writer.Write(faces.Length);
            WriteIntArray(compressionStream, faces);
        }
        return outputStream.ToArray();
    }

    private static void WriteFloatArray(Stream stream, float[] data)
    {
        var byteCount = data.Length * sizeof(float);
        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            Buffer.BlockCopy(data, 0, buffer, 0, byteCount);
            stream.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static void WriteIntArray(Stream stream, int[] data)
    {
        var byteCount = data.Length * sizeof(int);
        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            Buffer.BlockCopy(data, 0, buffer, 0, byteCount);
            stream.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <summary>Standard base64 length: 4 chars per 3 input bytes, rounded up.</summary>
    private static int Base64Length(int byteCount) => ((byteCount + 2) / 3) * 4;

    // ========================================================================
    // Compression-ratio regression benches on coherent geometry
    // ========================================================================
    //
    // The facts above use uniformly random vertices — the one input where the delta filter and
    // the v4 planar byte-split layout show nothing (random deltas are incompressible). Real
    // Grasshopper output is coherent: welded surfaces, scattered CAD parts, repeated instances.
    // These facts measure the deflated wire size on such geometry and assert a loose ceiling per
    // shape, so a change that silently weakens the filter pipeline (e.g. reordering the streams,
    // breaking the byte planes) fails here instead of shipping. Ceilings sit well above the
    // measured v4 ratios but below what the v3 interleaved layout produced — regression to either
    // random-quality or v3-quality compression trips them.

    /// <summary>
    ///     Welded height-field grid with a smooth swell plus small pseudo-random jitter (~25
    ///     quantization steps) — the analysis-surface case. Integer-derived jitter keeps the bytes
    ///     identical on every runtime.
    /// </summary>
    private static (float[] vertices, int[] indices) WeldedGrid(int size)
    {
        var vertices = new float[size * size * 3];
        var state = 12345u;
        for (var y = 0; y < size; y++)
        {
            for (var x = 0; x < size; x++)
            {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                var jitter = (state % 1000u) / 1000.0f * 0.05f - 0.025f;
                var i = (y * size + x) * 3;
                vertices[i] = x * 0.5f;
                vertices[i + 1] = y * 0.5f;
                vertices[i + 2] = (float)(3.0 * Math.Sin(x * 0.05) * Math.Cos(y * 0.07)
                                          + 0.6 * Math.Sin(x * 0.21 + y * 0.13)) + jitter;
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

    /// <summary>One axis-aligned box (24 verts / 12 tris, Rhino's box render-mesh shape) at (cx,cy,cz).</summary>
    private static void AppendBox(
        float[] vertices, int[] indices, ref int vertexCursor, ref int indexCursor,
        float cx, float cy, float cz, float sx, float sy, float sz)
    {
        var faces = new[]
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
                vertices[vertexCursor++] = cx + face[c * 3] * sx;
                vertices[vertexCursor++] = cy + face[c * 3 + 1] * sy;
                vertices[vertexCursor++] = cz + face[c * 3 + 2] * sz;
            }

            indices[indexCursor++] = baseIndex;
            indices[indexCursor++] = baseIndex + 1;
            indices[indexCursor++] = baseIndex + 2;
            indices[indexCursor++] = baseIndex;
            indices[indexCursor++] = baseIndex + 2;
            indices[indexCursor++] = baseIndex + 3;
        }
    }

    /// <summary>CAD scatter: many small boxes with unique sizes at pseudo-random positions.</summary>
    private static (float[] vertices, int[] indices) PartScatter(int count)
    {
        var vertices = new float[count * 24 * 3];
        var indices = new int[count * 12 * 3];
        var vertexCursor = 0;
        var indexCursor = 0;
        var state = 777u;
        float Next()
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            return (state % 10000u) / 10000.0f;
        }

        for (var b = 0; b < count; b++)
        {
            AppendBox(vertices, indices, ref vertexCursor, ref indexCursor,
                Next() * 100f, Next() * 100f, Next() * 20f,
                0.5f + Next() * 3f, 0.5f + Next() * 3f, 0.5f + Next() * 3f);
        }

        return (vertices, indices);
    }

    /// <summary>
    ///     The same part placed many times on a grid — repeated instances. The delta filter makes
    ///     each copy's vertex stream translation-invariant, so DEFLATE's LZ77 window dedupes the
    ///     2nd..Nth copies; this fact pins that behaviour.
    /// </summary>
    private static (float[] vertices, int[] indices) InstancedParts(int count)
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
            AppendBox(vertices, indices, ref vertexCursor, ref indexCursor,
                Next() % 80u * 5f, Next() % 80u * 5f, Next() % 10u * 5f,
                2f, 1.5f, 3f);
        }

        return (vertices, indices);
    }

    [Fact]
    public void Ratio_WeldedGrid()
    {
        // Measured 9.1% on net8 (the v3 interleaved layout produced 12.4%).
        RunRatio("welded grid 256x256 (65k verts, 130k tris)", WeldedGrid(256), maxRatio: 0.11);
    }

    [Fact]
    public void Ratio_PartScatter()
    {
        // Measured 6.8% on net8 (v3: ~14%).
        RunRatio("part scatter 3000 boxes (72k verts, 36k tris)", PartScatter(3000), maxRatio: 0.09);
    }

    [Fact]
    public void Ratio_InstancedParts()
    {
        // Repeated byte-identical parts: the regime where the writer's layout probe picks
        // interleaved. Measured 3.5% on net8 — planar would be 4.5% here, which is exactly the
        // regression the probe exists to avoid.
        RunRatio("instanced part x2000 (48k verts, 24k tris)", InstancedParts(2000), maxRatio: 0.05);
    }

    [Fact]
    public void Ratio_LayoutProbeNeverLosesToEitherFixedLayout()
    {
        // The guarantee the per-blob probe makes: on every shape, the blob it emits is no larger
        // than committing to planar or to interleaved everywhere. Without it, instanced geometry
        // regressed ~28% against the v3 interleaved layout.
        foreach (var (label, mesh) in new[]
                 {
                     ("welded grid", WeldedGrid(128)),
                     ("part scatter", PartScatter(1500)),
                     ("instanced parts", InstancedParts(2000))
                 })
        {
            var (vertices, indices) = mesh;
            byte[] blob;
            BinaryGeometryWriter.WriteResult result;
            using (var ms = new MemoryStream())
            {
                result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);
                blob = ms.ToArray();
            }

            var chosen = BlobCompressor.Compress(blob).Length;
            var alternative = BlobCompressor.Compress(SwapGeometryLayout(blob, result)).Length;

            _output.WriteLine(
                $"{label,-16} chose {(result.UsedPlanarByteSplit ? "planar" : "interleaved"),-12} " +
                $"{chosen,9:N0} bytes (other layout: {alternative,9:N0})");

            Assert.True(chosen <= alternative,
                $"{label}: emitted {chosen:N0} bytes but the other layout gives {alternative:N0}.");
        }
    }

    /// <summary>
    ///     Rewrites a blob's filtered geometry between the planar and interleaved layouts — same
    ///     values, same length, only byte order — yielding what the writer would have emitted had
    ///     the layout probe gone the other way.
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
            int[] planar =
            {
                offset + i, offset + n + i, offset + n * 2 + i,
                offset + n * 3 + i, offset + n * 4 + i, offset + n * 5 + i
            };
            int[] interleaved =
            {
                offset + i * 6, offset + i * 6 + 2, offset + i * 6 + 4,
                offset + i * 6 + 1, offset + i * 6 + 3, offset + i * 6 + 5
            };
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

    private void RunRatio(string label, (float[] vertices, int[] indices) mesh, double maxRatio)
    {
        var (vertices, indices) = mesh;

        byte[] rawSlva;
        BinaryGeometryWriter.WriteResult result;
        using (var ms = new MemoryStream())
        {
            result = BinaryGeometryWriter.Write(ms, "{}", vertices, indices);
            rawSlva = ms.ToArray();
        }

        Assert.False(result.UsedFloat32, "coherent bench geometry must stay on the quantized path");
        var compressed = BlobCompressor.Compress(rawSlva);

        // Ratio baseline: the unfiltered quantized payload (int16 verts + native-width indices),
        // i.e. what the streams occupy before any filtering or DEFLATE.
        var indexBytes = indices.Length * (result.UsedUint16Indices ? 2 : 4);
        var payloadBytes = result.VertexCount * 6 + indexBytes;
        var ratio = (double)compressed.Length / payloadBytes;

        _output.WriteLine($"=== {label} ===");
        _output.WriteLine($"Quantized payload   : {payloadBytes,12:N0} bytes");
        _output.WriteLine($"Raw SLVA            : {rawSlva.Length,12:N0} bytes");
        _output.WriteLine($"Deflated (SLVZ)     : {compressed.Length,12:N0} bytes");
        _output.WriteLine($"Ratio               : {ratio * 100:F1}% of quantized payload (ceiling {maxRatio * 100:F0}%)");

        Assert.True(ratio < maxRatio,
            $"{label}: deflated ratio {ratio:P1} exceeds the {maxRatio:P0} ceiling — " +
            "the filter/layout pipeline compresses coherent geometry worse than it used to.");
    }
}
