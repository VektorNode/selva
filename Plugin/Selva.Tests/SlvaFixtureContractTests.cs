using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

/// <summary>
///     Cross-stack SLVA contract: golden blobs written by the real BinaryGeometryWriter, committed
///     under packages/schemas/fixtures/slva/ and decoded on the TS side by
///     packages/visualization/src/parse/webdisplay/__tests__/slva-fixtures.test.ts (reads the SAME
///     files). Each blob ships with a .expected.json carrying the writer's inputs and quantization
///     tolerances, so the TS test asserts against C#-authored expectations — not against bytes a TS
///     helper produced, which is what the other parser tests use and which cannot catch
///     writer/parser drift.
///
///     A C# encoding change reddens this test until the fixtures are regenerated; regenerated
///     fixtures the TS parser mis-decodes redden vitest. Either way drift fails CI.
///
///     Regenerate after an intentional format change:
///         UPDATE_SLVA_FIXTURES=1 dotnet test --filter SlvaFixtureContractTests
///
///     The .slvz fixture is compared by decompressed content, not file bytes — DEFLATE output is
///     not guaranteed stable across .NET runtimes, the SLVA bytes inside are.
/// </summary>
public class SlvaFixtureContractTests
{
    private const string SourceComponentId = "44444444-4444-4444-8444-444444444444";

    private sealed class FixtureCase
    {
        public string Description = "";
        public float[] Vertices = Array.Empty<float>();
        public int[] Indices = Array.Empty<int>();
        public bool ForceFloat32;
        public float[] Uvs;
        public byte[] Colors;
        public bool Compress;

        /// <summary>Above this vertex count the expected.json stores spot samples, not full arrays.</summary>
        public bool SampleOnly;
    }

    // ========================================================================
    // Deterministic geometry
    // ========================================================================

    /// <summary>Unit cube: 8 vertices, 12 triangles. Extent 1.0 keeps the int16 step fine → quantized.</summary>
    private static (float[] vertices, int[] indices) Cube()
    {
        var vertices = new float[]
        {
            0f, 0f, 0f, 1f, 0f, 0f, 1f, 1f, 0f, 0f, 1f, 0f,
            0f, 0f, 1f, 1f, 0f, 1f, 1f, 1f, 1f, 0f, 1f, 1f
        };
        var indices = new[]
        {
            0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
            0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
            1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7
        };
        return (vertices, indices);
    }

    /// <summary>
    ///     nx × ny grid in the XY plane with a small deterministic Z ripple (integer arithmetic only,
    ///     so the floats are bit-identical on every runtime). uvSpan stretches UVs to force the
    ///     float32 UV fallback when > ~16.
    /// </summary>
    private static (float[] vertices, int[] indices, float[] uvs, byte[] colors) Grid(
        int nx, int ny, float uvSpan)
    {
        var vertexCount = nx * ny;
        var vertices = new float[vertexCount * 3];
        var uvs = new float[vertexCount * 2];
        var colors = new byte[vertexCount * 3];

        for (var j = 0; j < ny; j++)
        {
            for (var i = 0; i < nx; i++)
            {
                var v = j * nx + i;
                vertices[v * 3] = i * 0.01f;
                vertices[v * 3 + 1] = j * 0.01f;
                vertices[v * 3 + 2] = ((i + j) % 7) * 0.001f;

                uvs[v * 2] = i / (float)(nx - 1) * uvSpan;
                uvs[v * 2 + 1] = j / (float)(ny - 1) * uvSpan;

                colors[v * 3] = (byte)((i * 7) % 256);
                colors[v * 3 + 1] = (byte)((j * 11) % 256);
                colors[v * 3 + 2] = (byte)((i + j) % 256);
            }
        }

        var indices = new int[(nx - 1) * (ny - 1) * 6];
        var k = 0;
        for (var j = 0; j < ny - 1; j++)
        {
            for (var i = 0; i < nx - 1; i++)
            {
                var a = j * nx + i;
                var b = a + 1;
                var c = a + nx;
                var d = c + 1;
                indices[k++] = a;
                indices[k++] = c;
                indices[k++] = b;
                indices[k++] = b;
                indices[k++] = c;
                indices[k++] = d;
            }
        }

        return (vertices, indices, uvs, colors);
    }

    // ========================================================================
    // Fixture cases — one per format variant the writer can produce
    // ========================================================================

    private static Dictionary<string, FixtureCase> Cases()
    {
        var (cubeV, cubeI) = Cube();
        var (gridV, gridI, gridUv, gridC) = Grid(5, 5, 1f);
        var (tiledV, tiledI, tiledUv, _) = Grid(5, 5, 32f);
        // 257 * 257 = 66,049 vertices > 65,536 → uint32 indices.
        var (bigV, bigI, _, _) = Grid(257, 257, 1f);

        return new Dictionary<string, FixtureCase>
        {
            ["cube-quantized.slva"] = new FixtureCase
            {
                Description = "int16 quantized + delta, uint16 indices, no chunks",
                Vertices = cubeV,
                Indices = cubeI
            },
            ["cube-float32.slva"] = new FixtureCase
            {
                Description = "float32 raw vertices (forced), uint16 indices",
                Vertices = cubeV,
                Indices = cubeI,
                ForceFloat32 = true
            },
            ["grid-uv-color.slva"] = new FixtureCase
            {
                Description = "quantized, uint16 quantized UV chunk + vertex-color chunk",
                Vertices = gridV,
                Indices = gridI,
                Uvs = gridUv,
                Colors = gridC
            },
            ["grid-uv-tiled.slva"] = new FixtureCase
            {
                Description = "UV extent 32 exceeds the quantization step cap -> float32 UV chunk",
                Vertices = tiledV,
                Indices = tiledI,
                Uvs = tiledUv
            },
            ["empty.slva"] = new FixtureCase
            {
                Description = "zero vertices and indices — degenerate but valid",
                Vertices = Array.Empty<float>(),
                Indices = Array.Empty<int>()
            },
            ["large-uint32.slvz"] = new FixtureCase
            {
                Description = "66,049 vertices -> uint32 indices, SLVZ-compressed container",
                Vertices = bigV,
                Indices = bigI,
                Compress = true,
                SampleOnly = true
            }
        };
    }

    // ========================================================================
    // Blob + expected.json production
    // ========================================================================

    private static string MetadataJson(int vertexCount, int indexCount)
    {
        // Hand-assembled so the bytes don't depend on serializer property ordering.
        return
            "{\"materials\":[{\"color\":\"#ff8800\",\"metalness\":0.1,\"roughness\":0.8," +
            "\"opacity\":1.0,\"transparent\":false}]," +
            "\"groups\":[{\"materialId\":0,\"meshes\":[{\"name\":\"fixture\",\"layer\":\"Fixtures\"," +
            $"\"originalIndex\":0,\"vertexStart\":0,\"vertexCount\":{vertexCount}," +
            $"\"indexStart\":0,\"indexCount\":{indexCount}}}]}}]," +
            $"\"sourceComponentId\":\"{SourceComponentId}\"}}";
    }

    private static (byte[] fileBytes, byte[] rawSlva, JObject expected) Produce(FixtureCase c)
    {
        var vertexCount = c.Vertices.Length / 3;
        using var stream = new MemoryStream();
        var result = BinaryGeometryWriter.Write(
            stream,
            MetadataJson(vertexCount, c.Indices.Length),
            c.Vertices,
            c.Indices,
            c.ForceFloat32,
            c.Uvs,
            c.Colors);

        var rawSlva = stream.ToArray();
        var fileBytes = c.Compress ? BlobCompressor.Compress(rawSlva) : rawSlva;

        // Half a quantization step is the writer's max rounding error; 0.75 adds slack for the
        // float64→float32 comparison on the TS side. Float32 payloads are exact.
        var maxStep = Math.Max(result.ScaleX, Math.Max(result.ScaleY, result.ScaleZ));
        var positionTolerance = result.UsedFloat32 ? 1e-6 : maxStep * 0.75;

        double uvTolerance = 0;
        if (c.Uvs != null && c.Uvs.Length > 0)
        {
            uvTolerance = result.UsedFloat32Uvs
                ? 1e-6
                : (MaxComponent(c.Uvs) - MinComponent(c.Uvs)) / 65535.0 * 0.75;
        }

        var expected = new JObject
        {
            ["description"] = c.Description,
            ["flags"] = new JObject
            {
                ["float32"] = result.UsedFloat32,
                ["uint16Indices"] = result.UsedUint16Indices,
                ["deltaEncoded"] = true,
                ["hasUvs"] = c.Uvs != null,
                ["hasColors"] = c.Colors != null,
                ["float32Uvs"] = result.UsedFloat32Uvs
            },
            ["vertexCount"] = result.VertexCount,
            ["indexCount"] = result.IndexCount,
            ["origin"] = new JArray(result.OriginX, result.OriginY, result.OriginZ),
            ["scale"] = new JArray(result.ScaleX, result.ScaleY, result.ScaleZ),
            ["positionTolerance"] = positionTolerance,
            ["uvTolerance"] = uvTolerance,
            ["sourceComponentId"] = SourceComponentId
        };

        if (c.SampleOnly)
        {
            // Full arrays would dwarf the blob; spot samples pin the decode just as hard.
            var samples = new JArray();
            for (var v = 0; v < result.VertexCount; v += 4993) // prime stride — no lattice alignment
            {
                samples.Add(new JObject
                {
                    ["index"] = v,
                    ["x"] = c.Vertices[v * 3],
                    ["y"] = c.Vertices[v * 3 + 1],
                    ["z"] = c.Vertices[v * 3 + 2]
                });
            }

            expected["positionSamples"] = samples;
            expected["indexHead"] = new JArray(c.Indices.Take(24).Cast<object>().ToArray());
            expected["indexTail"] = new JArray(
                c.Indices.Skip(Math.Max(0, c.Indices.Length - 24)).Cast<object>().ToArray());
        }
        else
        {
            expected["positions"] = new JArray(c.Vertices.Cast<object>().ToArray());
            expected["indices"] = new JArray(c.Indices.Cast<object>().ToArray());
            if (c.Uvs != null)
            {
                expected["uvs"] = new JArray(c.Uvs.Cast<object>().ToArray());
            }

            if (c.Colors != null)
            {
                expected["colors"] = new JArray(c.Colors.Cast<object>().ToArray());
            }
        }

        return (fileBytes, rawSlva, expected);
    }

    private static double MinComponent(float[] values) => values.Min();
    private static double MaxComponent(float[] values) => values.Max();

    // ========================================================================
    // The contract test
    // ========================================================================

    [Fact]
    public void Fixtures_MatchTheWriterOutput()
    {
        var fixturesDir = Path.Combine(FindRepoRoot(), "packages", "schemas", "fixtures", "slva");
        var update = Environment.GetEnvironmentVariable("UPDATE_SLVA_FIXTURES") == "1";
        var failures = new List<string>();

        if (update)
        {
            Directory.CreateDirectory(fixturesDir);
        }

        foreach (var (fileName, c) in Cases())
        {
            var (fileBytes, rawSlva, expected) = Produce(c);
            var blobPath = Path.Combine(fixturesDir, fileName);
            var expectedPath = Path.Combine(fixturesDir,
                Path.GetFileNameWithoutExtension(fileName) + ".expected.json");

            if (update)
            {
                File.WriteAllBytes(blobPath, fileBytes);
                File.WriteAllText(expectedPath, expected.ToString(Formatting.Indented) + "\n");
                continue;
            }

            if (!File.Exists(blobPath) || !File.Exists(expectedPath))
            {
                failures.Add($"{fileName}: missing — run UPDATE_SLVA_FIXTURES=1 dotnet test");
                continue;
            }

            var committed = File.ReadAllBytes(blobPath);
            var committedRaw = DecompressIfSlvz(committed);
            if (!committedRaw.SequenceEqual(rawSlva))
            {
                failures.Add(
                    $"{fileName}: writer output drifted from the committed fixture " +
                    $"(committed {committedRaw.Length} bytes, produced {rawSlva.Length}).\n" +
                    "  If the change is intentional, regenerate (UPDATE_SLVA_FIXTURES=1) and make " +
                    "sure the TS slva-fixtures test still passes.");
            }

            var committedExpected = JToken.Parse(File.ReadAllText(expectedPath));
            // Round-trip through text first: boxed float JValues don't DeepEquals re-parsed doubles.
            var producedExpected = JToken.Parse(expected.ToString(Formatting.Indented));
            if (!JToken.DeepEquals(committedExpected, producedExpected))
            {
                failures.Add($"{fileName}: expected.json drifted — regenerate with UPDATE_SLVA_FIXTURES=1.");
            }
        }

        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    /// <summary>
    ///     Undoes the SLVZ container (magic + uncompressedLen + raw DEFLATE). BlobCompressor only
    ///     compresses — the production decoder is TS — so the test inflates locally. Non-SLVZ input
    ///     passes through, matching the decoder's magic-sniffing.
    /// </summary>
    private static byte[] DecompressIfSlvz(byte[] bytes)
    {
        if (bytes.Length < 8 || BitConverter.ToUInt32(bytes, 0) != BlobCompressor.CompressedMagic)
        {
            return bytes;
        }

        var uncompressedLen = BitConverter.ToUInt32(bytes, 4);
        using var input = new MemoryStream(bytes, 8, bytes.Length - 8);
        using var deflate = new System.IO.Compression.DeflateStream(
            input, System.IO.Compression.CompressionMode.Decompress);
        using var output = new MemoryStream((int)uncompressedLen);
        deflate.CopyTo(output);
        return output.ToArray();
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new DirectoryNotFoundException(
            "Could not locate repo root (pnpm-workspace.yaml) from " + AppContext.BaseDirectory);
    }
}
