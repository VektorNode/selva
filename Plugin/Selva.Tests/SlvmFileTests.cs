using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

/// <summary>
///     The <c>.slvm</c> mesh file is written to users' disks and read back by a later plugin build,
///     so a round-trip that quietly drops a field degrades a saved file rather than failing. Two
///     contracts guard here: the SLVM v2 container round-trips every batch field, and files written
///     by the retired DMF1 writer stay readable forever.
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
            BatchId = "component-7",
            // Not an SLVA blob: Write adopts unknown geometry bytes verbatim, which is exactly
            // what the byte-exactness tests below want to observe.
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
                            VertexCount = 8, IndexCount = 12, VertexStart = 0, IndexStart = 0,
                            Metadata = new Dictionary<string, string> { ["fire"] = "REI60" }
                        }
                    }
                }
            }
        };
    }

    /// <summary>The GEOM payload of a batch's container — the bytes the file stores verbatim.</summary>
    private static byte[] GeometryBlobOf(DisplayBatch batch)
    {
        return SlvmDocument.Read(batch.CompressedData).GeometryBlob;
    }

    [Fact]
    public void RoundTrip_PreservesEveryEnvelopeField()
    {
        var decoded = RoundTrip(SampleBatch());

        Assert.Equal("component-7", decoded.BatchId);

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
        // v2 derives the offsets the parsers slice on from prefix sums over the table.
        Assert.Equal(0, mesh.VertexStart);
        Assert.Equal(0, mesh.IndexStart);
        Assert.Equal("REI60", mesh.Metadata["fire"]);
    }

    [Fact]
    public void RoundTrip_PreservesCurveItemsIncludingTheirRhinoJson()
    {
        // Items are the half of the batch that isn't mesh geometry. DisplayItem.Json is the exact
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
        Assert.NotNull(item.Points);
        // Polyline vertices are quantized into the item bbox, so equality is approximate.
        for (var i = 0; i < 6; i++)
        {
            Assert.Equal(new double[] { 0, 0, 0, 1, 1, 1 }[i], item.Points[i], 3);
        }

        Assert.Equal("component-7:0", item.Id);
        Assert.Equal("beam", item.Name);
        Assert.Equal("Structure/Beams", item.Layer);
        Assert.Equal("6m", item.Metadata["span"]);
        Assert.Equal("#00ff00", item.Color);
        Assert.Equal(0.8, item.Opacity!.Value, 3);
    }

    [Fact]
    public void RoundTrip_PreservesTheGeometryBlobBytesExactly()
    {
        // Save/load must never re-encode the geometry: the file adopts the blob as its GEOM
        // payload byte-for-byte. Bytes that could be mistaken for EOF (0x00, 0x1A) included.
        var blob = new byte[] { 0x53, 0x4C, 0x56, 0x41, 0x00, 0x1A, 0xFF, 0x7F, 0x00 };

        var decoded = RoundTrip(SampleBatch(blob));

        Assert.Equal(blob, GeometryBlobOf(decoded));
    }

    [Fact]
    public void RoundTrip_SurvivesABlobLargerThanOneReadChunk()
    {
        var blob = new byte[20000];
        for (var i = 0; i < blob.Length; i++)
        {
            blob[i] = (byte)(i % 251);
        }

        var decoded = RoundTrip(SampleBatch(blob));

        Assert.Equal(blob, GeometryBlobOf(decoded));
    }

    [Fact]
    public void Write_AcceptsABatchWithNoBlob()
    {
        // An items-only batch (curves/points, no meshable geometry) has no CompressedData; Write
        // substitutes a valid empty geometry blob rather than throwing.
        var batch = SampleBatch();
        batch.CompressedData = null;

        var decoded = RoundTrip(batch);

        Assert.True(SlvmDocument.IsSlvm(decoded.CompressedData));
    }

    [Fact]
    public void Read_StillAcceptsALegacyDmf1File()
    {
        // Files written before SLVM v2 exist on users' disks; the reader dispatches on the DMF1
        // magic and must accept them forever. The old writer is gone, so build its exact byte
        // shape by hand: header, JSON sidecar, then the raw blob to end-of-file.
        var sidecar = JsonConvert.SerializeObject(new
        {
            materials = new[] { new { color = "#123456", metalness = 0.1, roughness = 0.9, opacity = 1.0, transparent = false } },
            groups = new[]
            {
                new
                {
                    materialId = 0,
                    meshes = new[]
                    {
                        new
                        {
                            name = "legacy", layer = "Old/Layer", originalIndex = 2,
                            vertexCount = 4, indexCount = 6, vertexStart = 10, indexStart = 20,
                            metadata = new Dictionary<string, string> { ["k"] = "v" }
                        }
                    }
                }
            },
            // The DMF1 sidecar's own JSON key — the pre-rename spelling, frozen on users' disks.
            sourceComponentId = "legacy-id"
        });
        var blob = new byte[] { 0x53, 0x4C, 0x56, 0x5A, 9, 8, 7 };

        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true))
        {
            w.Write(SlvmFile.Magic);
            w.Write(SlvmFile.Version);
            var jsonBytes = Encoding.UTF8.GetBytes(sidecar);
            w.Write((uint)jsonBytes.Length);
            w.Write(jsonBytes);
            w.Write(blob);
        }

        ms.Position = 0;
        var decoded = SlvmFile.Read(ms);

        Assert.Equal("legacy-id", decoded.BatchId);
        Assert.Equal("#123456", decoded.Materials[0].Color);
        var mesh = decoded.Groups[0].Meshes[0];
        Assert.Equal("legacy", mesh.Name);
        Assert.Equal(2, mesh.OriginalIndex);
        // DMF1 stored the windows explicitly; the legacy path must keep them verbatim.
        Assert.Equal(10, mesh.VertexStart);
        Assert.Equal(20, mesh.IndexStart);
        Assert.Equal(blob, decoded.CompressedData);
    }

    [Fact]
    public void Read_RejectsAFileThatIsNeitherSlvmNorDmf()
    {
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true))
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
        // Forward compatibility is deliberately NOT offered for the container (unlike the geometry
        // blob, which is flag-additive): a newer chunk set can't be read by an older plugin, so it
        // must say so rather than deserialize a partial batch.
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true))
        {
            w.Write(SlvmDocument.Magic);
            w.Write(SlvmDocument.Version + 1);
            w.Write(0u);
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
        using var ms = new MemoryStream();
        SlvmFile.Write(ms, SampleBatch());
        ms.WriteByte(0xAB);

        Assert.True(ms.Length > 0);
    }
}
