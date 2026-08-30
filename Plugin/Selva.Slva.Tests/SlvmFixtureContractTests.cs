using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Slva;

namespace Selva.Slva.Tests;

/// <summary>
///     Cross-stack SLVM v3 contract: golden containers written by the real production path
///     (<see cref="MeshBatchAssembler.CreateBatch" /> → <see cref="SlvmDocument.Write" />), committed
///     under <c>packages/schemas/fixtures/slvm3/</c> and decoded on the TS side by
///     <c>slvm-fixtures.test.ts</c> (reads the SAME files). A C# container change reddens this test
///     until the fixtures are regenerated (<c>UPDATE_SLVM_FIXTURES=1 dotnet test</c>); regenerated
///     fixtures the TS parser mis-decodes redden vitest. Either way drift fails CI.
/// </summary>
public class SlvmFixtureContractTests
{
    private static ThreeMaterial Material(Color color, string map = null)
    {
        var m = ThreeMaterial.Default();
        m.Color = color;
        m.Map = map;
        return m;
    }

    private static readonly float[] Quad =
    {
        0f, 0f, 0f, 1f, 0f, 0f, 1f, 1f, 0f, 0f, 1f, 0f
    };

    private static readonly int[] QuadFaces = { 0, 1, 2, 0, 2, 3 };

    private static float[] QuadAt(float dx, float dy, float dz)
    {
        var v = (float[])Quad.Clone();
        for (var i = 0; i < v.Length; i += 3)
        {
            v[i] += dx;
            v[i + 1] += dy;
            v[i + 2] += dz;
        }

        return v;
    }

    private static IEnumerable<(string fileName, DisplayBatch batch)> Cases()
    {
        // Two meshes, one material, default sequential names, no layers/metadata/ids: the common
        // foreign-writer case, exercising the zero-cost table columns (sequential names, no pool,
        // no attr columns at all).
        var red = Material(Color.Red);
        yield return ("plain-sequential.slvm", MeshBatchAssembler.CreateBatch(
            new List<SlvaMeshInput>
            {
                new SlvaMeshInput { Vertices = QuadAt(0, 0, 0), Faces = QuadFaces, Name = "1", Material = red },
                new SlvaMeshInput { Vertices = QuadAt(2, 0, 0), Faces = QuadFaces, Name = "2", Material = red }
            }));

        // Materials interleaved in input order (red, blue, red): the assembler's material sort
        // reorders the table, and only the per-object id attr keeps identity attached. Names,
        // layers, ids and per-mesh metadata exercise the pool and the sparse attr columns.
        var blue = Material(Color.Blue);
        yield return ("multi-material.slvm", MeshBatchAssembler.CreateBatch(
            new List<SlvaMeshInput>
            {
                new SlvaMeshInput
                {
                    Id = "fixture-multi/{0;0}/0",
                    Vertices = QuadAt(0, 0, 0), Faces = QuadFaces, Name = "wall",
                    Layer = "Structure/Walls", Material = red,
                    Metadata = new Dictionary<string, string> { ["fire"] = "REI60" }
                },
                new SlvaMeshInput
                {
                    Id = "fixture-multi/{0;0}/1",
                    Vertices = QuadAt(2, 0, 0), Faces = QuadFaces, Name = "window",
                    Layer = "Facade/Windows", Material = blue
                },
                new SlvaMeshInput
                {
                    Id = "fixture-multi/{0;1}/0",
                    Vertices = QuadAt(4, 0, 0), Faces = QuadFaces, Name = "wall2",
                    Layer = "Structure/Walls", Material = red
                }
            }));

        // A data-URI texture: extracted into a TEXR chunk on write, reconstructed on read.
        var pngBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4 };
        var textured = Material(Color.White, "data:image/png;base64," + Convert.ToBase64String(pngBytes));
        yield return ("textured.slvm", MeshBatchAssembler.CreateBatch(
            new List<SlvaMeshInput>
            {
                new SlvaMeshInput
                {
                    Id = "fixture-textured/{0}/0",
                    Vertices = QuadAt(0, 0, 0), Faces = QuadFaces, Name = "1", Material = textured,
                    Uvs = new float[] { 0, 0, 1, 0, 1, 1, 0, 1 }
                }
            }));
    }

    private static JObject Expected(DisplayBatch batch)
    {
        // The whole metadata surface the TS decoder must reconstruct from TABL/MATL/TEXR/EXTN,
        // serialized through the same JSON contract the legacy envelope used.
        return new JObject
        {
            ["materials"] = JArray.Parse(JsonConvert.SerializeObject(batch.Materials)),
            ["groups"] = JArray.Parse(JsonConvert.SerializeObject(batch.Groups)),
            ["totalVertexCount"] = batch.Groups.SelectMany(g => g.Meshes).Sum(m => m.VertexCount),
            ["totalIndexCount"] = batch.Groups.SelectMany(g => g.Meshes).Sum(m => m.IndexCount),
            ["positionTolerance"] = 0.001
        };
    }

    [Fact]
    public void Fixtures_MatchTheWriterOutput()
    {
        var fixturesDir = FixtureLocator.Dir("slvm3");
        var update = Environment.GetEnvironmentVariable("UPDATE_SLVM_FIXTURES") == "1";
        var failures = new List<string>();

        if (update)
        {
            Directory.CreateDirectory(fixturesDir);
        }

        foreach (var (fileName, batch) in Cases())
        {
            var fileBytes = batch.CompressedData;
            var expected = Expected(batch);
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
                failures.Add($"{fileName}: missing — run UPDATE_SLVM_FIXTURES=1 dotnet test");
                continue;
            }

            var committed = File.ReadAllBytes(blobPath);
            if (!committed.SequenceEqual(fileBytes))
            {
                failures.Add(
                    $"{fileName}: writer output drifted from the committed fixture " +
                    $"(committed {committed.Length} bytes, produced {fileBytes.Length}).\n" +
                    "  If the change is intentional, regenerate (UPDATE_SLVM_FIXTURES=1) and make " +
                    "sure the TS slvm-fixtures test still passes.");
            }

            var committedExpected = JToken.Parse(File.ReadAllText(expectedPath));
            var producedExpected = JToken.Parse(expected.ToString(Formatting.Indented));
            if (!JToken.DeepEquals(committedExpected, producedExpected))
            {
                failures.Add($"{fileName}: expected.json drifted — regenerate with UPDATE_SLVM_FIXTURES=1.");
            }

            // The committed container must also round-trip through the C# reader.
            var decoded = SlvmDocument.Read(committed);
            var writtenIds = batch.Groups.SelectMany(g => g.Meshes).Select(m => m.Id);
            var readIds = decoded.Batch.Groups.SelectMany(g => g.Meshes).Select(m => m.Id);
            if (!writtenIds.SequenceEqual(readIds))
            {
                failures.Add($"{fileName}: reader lost object ids.");
            }
        }

        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

}
