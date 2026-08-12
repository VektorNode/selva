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
}
