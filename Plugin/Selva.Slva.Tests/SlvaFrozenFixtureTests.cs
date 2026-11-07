using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json.Linq;
using Selva.Slva;

namespace Selva.Slva.Tests;

/// <summary>
///     Backward-compatibility contract: the frozen pre-v4 blobs under
///     packages/schemas/fixtures/slva/v3/ must decode correctly forever — they stand in for every
///     blob persisted before a format bump (saved .gh params, .slvm files, cached compute
///     results). Unlike <see cref="SlvaFixtureContractTests" /> these are never regenerated; a
///     failure here means a format regression, not fixture drift. Each blob goes through both the
///     independent <see cref="SlvaTestDecoder" /> and the production <see cref="SlvaReader" />; the
///     TS slva-fixtures test decodes the same files with the production parser.
/// </summary>
public class SlvaFrozenFixtureTests
{
    // Frozen means these bytes, not merely "still decodes": a re-encoded fixture would pass every
    // decode test while no longer standing in for what is on users' disks.
    private static readonly Dictionary<string, string> FrozenSha256 = new()
    {
        ["cube-float32.expected.json"] = "34b5a13720463d948501ea96ac248f5268a0282ac40099bdc33433ed8d556943",
        ["cube-float32.slva"] = "ade65aa9262f3595e31b8ecddd45d8ab2da08a5a5c9f651eb155fb7a25f3cedb",
        ["cube-quantized.expected.json"] = "612b7f2a9dcc86c97c9f27c7b5104c57e13c5b0df5ed5e41686b3130396e9495",
        ["cube-quantized.slva"] = "fd01cf585ed31d79e9a46a9a65c5837c5e5220aa33a6ad00ef3962cb46496a85",
        ["empty.expected.json"] = "d3d1cd5f3da37dcd0d8f5b21713ed0a6ede2e0bc8c97fe62c4f46759b6c2d301",
        ["empty.slva"] = "dce16796477fafdc85dcd1f5bf95bfe4a7c62903b0d87d13f6a1b95e82b17310",
        ["grid-uv-color.expected.json"] = "e6e4fbb9e99677162029572cdc554d11463b1180a4a8b071d0beba58a0f3d01d",
        ["grid-uv-color.slva"] = "d08bbed0407b432002edbb36668c139dddcc4035d2a71c0807fda9f1ce54a204",
        ["grid-uv-tiled.expected.json"] = "02a925c47c47c38208111ba0f0468b7b58d5b06dc3251c077d017db4b454d4f4",
        ["grid-uv-tiled.slva"] = "f60e42432aee54cce49ce6a2e4503a7fe19e96ad2b61f4f222d3f3ee2fee7c61",
        ["large-uint32.expected.json"] = "31f88a476940854bdf72bfd8b6cf8a7560aa484e6f74f6de2cc6f778a72cd321",
        ["large-uint32.slvz"] = "8c06d96fc3a5e5c0f67f4594ca9ca9b2a1cf6584c7a0a109b8efdd75b734eb64"
    };

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

    [Fact]
    public void FrozenFixtures_AreByteForByteTheCommittedOnes()
    {
        var onDisk = Directory.GetFiles(FixturesDir())
            .ToDictionary(Path.GetFileName, path => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant());

        Assert.Equal(FrozenSha256.OrderBy(kv => kv.Key), onDisk.OrderBy(kv => kv.Key));
    }

    [Theory]
    [MemberData(nameof(FrozenBlobs))]
    public void FrozenBlob_DecodesToItsExpectedJson(string blobName)
    {
        var (blob, expected) = Load(blobName);

        var decoded = SlvaTestDecoder.ReadAll(SlvaTestDecoder.DecompressIfSlvz(blob));
        Assert.InRange(decoded.Version, 1u, 3u);
        Assert.Equal(expected.Value<string>("sourceComponentId"),
            JObject.Parse(decoded.MetadataJson).Value<string>("sourceComponentId"));

        AssertMatches(expected, decoded.Vertices, decoded.Indices.Select(i => (long)i).ToArray(),
            decoded.Uvs, decoded.Colors);
    }

    // SlvaReader is the decoder the plugin itself runs on saved blobs, so it is the one a
    // regression on old blobs actually reaches.
    [Theory]
    [MemberData(nameof(FrozenBlobs))]
    public void FrozenBlob_SlvaReaderDecodesToItsExpectedJson(string blobName)
    {
        var (blob, expected) = Load(blobName);

        var decoded = SlvaReader.Read(blob);

        Assert.NotNull(decoded.Metadata);
        AssertMatches(expected, decoded.Vertices, decoded.Indices.Select(i => (long)i).ToArray(),
            decoded.Uvs, decoded.Colors);
    }

    private static (byte[] Blob, JObject Expected) Load(string blobName)
    {
        var dir = FixturesDir();
        var blob = File.ReadAllBytes(Path.Combine(dir, blobName));
        var expectedPath = Path.Combine(dir,
            Path.GetFileNameWithoutExtension(blobName) + ".expected.json");
        return (blob, JObject.Parse(File.ReadAllText(expectedPath)));
    }

    private static void AssertMatches(JObject expected, float[] vertices, long[] indices, float[] uvs,
        byte[] colors)
    {
        var vertexCount = expected.Value<int>("vertexCount");
        var indexCount = expected.Value<int>("indexCount");
        Assert.Equal(vertexCount * 3, vertices.Length);
        Assert.Equal(indexCount, indices.Length);

        var tolerance = expected.Value<double>("positionTolerance");

        if (expected["positions"] is JArray positions)
        {
            for (var i = 0; i < positions.Count; i++)
            {
                Assert.InRange(vertices[i] - positions[i].Value<double>(), -tolerance, tolerance);
            }
        }

        foreach (var sample in expected["positionSamples"] as JArray ?? new JArray())
        {
            var v = sample.Value<int>("index");
            Assert.InRange(vertices[v * 3] - sample.Value<double>("x"), -tolerance, tolerance);
            Assert.InRange(vertices[v * 3 + 1] - sample.Value<double>("y"), -tolerance, tolerance);
            Assert.InRange(vertices[v * 3 + 2] - sample.Value<double>("z"), -tolerance, tolerance);
        }

        if (expected["indices"] is JArray all)
        {
            Assert.Equal(all.Select(t => t.Value<long>()), indices);
        }

        if (expected["indexHead"] is JArray head)
        {
            Assert.Equal(head.Select(t => t.Value<long>()), indices.Take(head.Count));
        }

        if (expected["indexTail"] is JArray tail)
        {
            Assert.Equal(tail.Select(t => t.Value<long>()),
                indices.Skip(Math.Max(0, indices.Length - tail.Count)));
        }

        if (expected["uvs"] is JArray expectedUvs)
        {
            var uvTolerance = expected.Value<double>("uvTolerance");
            Assert.NotNull(uvs);
            for (var i = 0; i < expectedUvs.Count; i++)
            {
                Assert.InRange(uvs[i] - expectedUvs[i].Value<double>(), -uvTolerance, uvTolerance);
            }
        }

        if (expected["colors"] is JArray expectedColors)
        {
            Assert.Equal(expectedColors.Select(t => (byte)t.Value<int>()), colors);
        }
    }

    private static string FixturesDir()
    {
        return FixtureLocator.Dir("slva", "v3");
    }
}
