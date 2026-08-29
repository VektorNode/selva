using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.Slva;

namespace Selva.Slva.Tests;

/// <summary>
///     Backward-compatibility contract: the frozen pre-v4 blobs under
///     packages/schemas/fixtures/slva/v3/ must decode correctly forever — they stand in for every
///     blob persisted before a format bump (saved .gh params, .slvm files, cached compute
///     results). Unlike <see cref="SlvaFixtureContractTests" /> these are never regenerated; a
///     failure here means a format regression, not fixture drift. The TS slva-fixtures test
///     decodes the same files with the production parser.
/// </summary>
public class SlvaFrozenFixtureTests
{
    public static TheoryData<string> FrozenBlobs()
    {
        var data = new TheoryData<string>();
        foreach (var path in Directory.GetFiles(FixturesDir())
                     .Where(p => p.EndsWith(".slva") || p.EndsWith(".slvz")))
        {
            data.Add(Path.GetFileName(path));
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(FrozenBlobs))]
    public void FrozenBlob_DecodesToItsExpectedJson(string blobName)
    {
        var dir = FixturesDir();
        var blob = File.ReadAllBytes(Path.Combine(dir, blobName));
        var expectedPath = Path.Combine(dir,
            Path.GetFileNameWithoutExtension(blobName) + ".expected.json");
        var expected = JObject.Parse(File.ReadAllText(expectedPath));

        var decoded = SlvaTestDecoder.ReadAll(SlvaTestDecoder.DecompressIfSlvz(blob));
        Assert.InRange(decoded.Version, 1u, 3u);

        var vertexCount = expected.Value<int>("vertexCount");
        var indexCount = expected.Value<int>("indexCount");
        Assert.Equal(vertexCount * 3, decoded.Vertices.Length);
        Assert.Equal(indexCount, decoded.Indices.Length);
        Assert.Equal(expected.Value<string>("sourceComponentId"),
            JObject.Parse(decoded.MetadataJson).Value<string>("sourceComponentId"));

        var tolerance = expected.Value<double>("positionTolerance");

        if (expected["positions"] is JArray positions)
        {
            for (var i = 0; i < positions.Count; i++)
            {
                Assert.InRange(decoded.Vertices[i] - positions[i].Value<double>(),
                    -tolerance, tolerance);
            }
        }

        foreach (var sample in expected["positionSamples"] as JArray ?? new JArray())
        {
            var v = sample.Value<int>("index");
            Assert.InRange(decoded.Vertices[v * 3] - sample.Value<double>("x"), -tolerance, tolerance);
            Assert.InRange(decoded.Vertices[v * 3 + 1] - sample.Value<double>("y"), -tolerance, tolerance);
            Assert.InRange(decoded.Vertices[v * 3 + 2] - sample.Value<double>("z"), -tolerance, tolerance);
        }

        if (expected["indices"] is JArray indices)
        {
            Assert.Equal(indices.Select(t => t.Value<uint>()), decoded.Indices);
        }

        if (expected["indexHead"] is JArray head)
        {
            Assert.Equal(head.Select(t => t.Value<uint>()), decoded.Indices.Take(head.Count));
        }

        if (expected["indexTail"] is JArray tail)
        {
            Assert.Equal(tail.Select(t => t.Value<uint>()),
                decoded.Indices.Skip(Math.Max(0, decoded.Indices.Length - tail.Count)));
        }

        if (expected["uvs"] is JArray uvs)
        {
            var uvTolerance = expected.Value<double>("uvTolerance");
            Assert.NotNull(decoded.Uvs);
            for (var i = 0; i < uvs.Count; i++)
            {
                Assert.InRange(decoded.Uvs[i] - uvs[i].Value<double>(), -uvTolerance, uvTolerance);
            }
        }

        if (expected["colors"] is JArray colors)
        {
            Assert.Equal(colors.Select(t => (byte)t.Value<int>()), decoded.Colors);
        }
    }

    private static string FixturesDir()
    {
        return FixtureLocator.Dir("slva", "v3");
    }
}
