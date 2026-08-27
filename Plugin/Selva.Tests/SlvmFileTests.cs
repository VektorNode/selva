using System;
using System.Collections.Generic;
using System.IO;
using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

/// <summary>
///     The <c>.slvm</c> mesh file is written to users' disks and read back by a later plugin build,
///     so a round-trip that quietly drops a field degrades a saved file rather than failing. Its
///     one structural risk: <see cref="SlvmFile.Write" /> serializes a private Sidecar type but
///     <see cref="SlvmFile.Read" /> deserializes into <see cref="DisplayBatch" />, so the two shapes
///     agree only by matching JSON property names — nothing checks that at compile time.
/// </summary>
public class SlvmFileTests
{
    private static DisplayBatch RoundTrip(DisplayBatch batch)
    {
        using var ms = new MemoryStream();
        SlvmFile.Write(ms, batch);
        ms.Position = 0;
        return SlvmFile.Read(ms);
    }

    private static DisplayBatch SampleBatch(byte[] blob = null)
    {
        return new DisplayBatch
        {
            SourceComponentId = "component-7",
            CompressedData = blob ?? new byte[] { 1, 2, 3, 4, 5 },
            Materials = new List<SerializableMaterial>
            {
                new SerializableMaterial
                {
                    Color = "#ff8800", Metalness = 0.25, Roughness = 0.75,
                    Opacity = 0.5, Transparent = true, Map = "https://example.test/t.png"
                }
            },
            Groups = new List<MaterialGroup>
            {
                new MaterialGroup
                {
                    MaterialId = 0,
                    Meshes = new List<MeshMetadata>
                    {
                        new MeshMetadata
                        {
                            Name = "wall", Layer = "Structure/Walls", OriginalIndex = 3,
                            VertexCount = 8, IndexCount = 12, VertexStart = 16, IndexStart = 24,
                            Metadata = new Dictionary<string, string> { ["fire"] = "REI60" }
                        }
                    }
                }
            }
        };
    }

    [Fact]
    public void RoundTrip_PreservesEveryEnvelopeField()
    {
        // The Sidecar/DisplayBatch name-matching contract. A renamed JsonProperty on either side
        // leaves the field silently null here rather than failing to compile.
        var decoded = RoundTrip(SampleBatch());

        Assert.Equal("component-7", decoded.SourceComponentId);

        var material = decoded.Materials[0];
        Assert.Equal("#ff8800", material.Color);
        Assert.Equal(0.25, material.Metalness);
        Assert.Equal(0.75, material.Roughness);
        Assert.Equal(0.5, material.Opacity);
        Assert.True(material.Transparent);
        Assert.Equal("https://example.test/t.png", material.Map);

        var mesh = decoded.Groups[0].Meshes[0];
        Assert.Equal("wall", mesh.Name);
        Assert.Equal("Structure/Walls", mesh.Layer);
        Assert.Equal(3, mesh.OriginalIndex);
        Assert.Equal(8, mesh.VertexCount);
        Assert.Equal(12, mesh.IndexCount);
        // The offsets the parsers slice on: a dropped VertexStart reads as 0 and renders the wrong
        // vertices rather than erroring.
        Assert.Equal(16, mesh.VertexStart);
        Assert.Equal(24, mesh.IndexStart);
        Assert.Equal("REI60", mesh.Metadata["fire"]);
    }

    [Fact]
    public void RoundTrip_PreservesCurveItemsIncludingTheirRhinoJson()
    {
        // Items are the half of the batch that isn't in the blob. DisplayItem.Json is the exact
        // NURBS form: losing it downgrades a reloaded file's viewport preview to its tessellation,
        // and DisplayBatchTransformer to compounding tessellation error on repeated transforms.
        var batch = SampleBatch();
        batch.Items = new List<DisplayItem>
        {
            DisplayItem.Curve(
                "{\"version\":10000,\"archive3dm\":70}",
                new double[] { 0, 0, 0, 1, 1, 1 },
                "component-7:0", "beam", "Structure/Beams",
                new Dictionary<string, string> { ["span"] = "6m" },
                "#00ff00", 0.8)
        };

        var decoded = RoundTrip(batch);

        var item = Assert.Single(decoded.Items);
        Assert.Equal("curve", item.Kind);
        Assert.Equal("{\"version\":10000,\"archive3dm\":70}", item.Json);
        Assert.Equal(new double[] { 0, 0, 0, 1, 1, 1 }, item.Points);
        Assert.Equal("component-7:0", item.Id);
        Assert.Equal("beam", item.Name);
        Assert.Equal("Structure/Beams", item.Layer);
        Assert.Equal("6m", item.Metadata["span"]);
        Assert.Equal("#00ff00", item.Color);
        Assert.Equal(0.8, item.Opacity);
    }

    [Fact]
    public void RoundTrip_PreservesTheBlobBytesExactly()
    {
        // The blob trails the JSON to end-of-file with no length prefix, so Read recovers it by
        // draining the reader. An off-by-one there corrupts the SLVA header rather than truncating
        // visibly. A byte that could be mistaken for EOF (0x00, 0x1A) is included deliberately.
        var blob = new byte[] { 0x53, 0x4C, 0x56, 0x41, 0x00, 0x1A, 0xFF, 0x7F, 0x00 };

        var decoded = RoundTrip(SampleBatch(blob));

        Assert.Equal(blob, decoded.CompressedData);
    }

    [Fact]
    public void RoundTrip_SurvivesABlobLargerThanTheReadChunk()
    {
        // Read drains through an 8 KB buffer; a batch that fits in one chunk would never exercise
        // the loop's continuation.
        var blob = new byte[20000];
        for (var i = 0; i < blob.Length; i++)
        {
            blob[i] = (byte)(i % 251);
        }

        var decoded = RoundTrip(SampleBatch(blob));

        Assert.Equal(blob, decoded.CompressedData);
    }

    [Fact]
    public void Write_AcceptsABatchWithNoBlob()
    {
        // An items-only batch (curves/points, no meshes) has no CompressedData; Write substitutes
        // an empty array rather than throwing.
        var batch = SampleBatch();
        batch.CompressedData = null;

        var decoded = RoundTrip(batch);

        Assert.Empty(decoded.CompressedData);
    }

    [Fact]
    public void Read_RejectsAFileThatIsNotDmf()
    {
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms, System.Text.Encoding.UTF8, leaveOpen: true))
        {
            w.Write(0xDEADBEEFu);
            w.Write(SlvmFile.Version);
            w.Write(0u);
        }

        ms.Position = 0;
        Assert.Throws<InvalidDataException>(() => SlvmFile.Read(ms));
    }

    [Fact]
    public void Read_RejectsAFutureVersion()
    {
        // Forward compatibility is deliberately NOT offered here (unlike SLVA, which is
        // flag-additive): a newer sidecar shape can't be read by an older plugin, so it must say so
        // rather than deserialize a partial batch.
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms, System.Text.Encoding.UTF8, leaveOpen: true))
        {
            w.Write(SlvmFile.Magic);
            w.Write(SlvmFile.Version + 1);
            w.Write(2u);
            w.Write(System.Text.Encoding.UTF8.GetBytes("{}"));
        }

        ms.Position = 0;
        Assert.Throws<InvalidDataException>(() => SlvmFile.Read(ms));
    }

    [Fact]
    public void Write_RejectsNullArguments()
    {
        using var ms = new MemoryStream();
        Assert.Throws<ArgumentNullException>(() => SlvmFile.Write(null!, SampleBatch()));
        Assert.Throws<ArgumentNullException>(() => SlvmFile.Write(ms, null!));
        Assert.Throws<ArgumentNullException>(() => SlvmFile.Read(null!));
    }

    [Fact]
    public void Write_LeavesTheStreamOpenForTheCaller()
    {
        // Both sides pass leaveOpen: true so a caller can embed the file in a larger stream. If a
        // BinaryWriter ever closed it, this would throw on the following write.
        using var ms = new MemoryStream();
        SlvmFile.Write(ms, SampleBatch());
        ms.WriteByte(0xAB);

        Assert.True(ms.Length > 0);
    }
}
