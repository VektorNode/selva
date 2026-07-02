using System;
using System.IO;
using System.Text;
using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

public class BinaryGeometryWriterTests
{
    private const uint ExpectedMagic = 0x41564C53;
    private const uint ExpectedVersion = 3;

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
        br.ReadUInt32(); // magic
        br.ReadUInt32(); // version
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
        // Small batch: int16 verts (bit 0 clear) + uint16 indices (bit 1) + delta filter (bit 2).
        Assert.Equal(BinaryGeometryWriter.FlagUint16Indices | BinaryGeometryWriter.FlagDeltaEncoded, flags);

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
        // Float32 verts (bit 0) and — being a 4-vertex batch — uint16 indices (bit 1) too.
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

    /// <summary>
    ///     Decodes the binary blob the same way the JS parser will: peel envelope, peel geometry
    ///     header, dequantize int16 (or read float32 directly), and read uint16/uint32 indices per
    ///     the flags word — undoing the v3 delta+zigzag filter when its flag is set.
    /// </summary>
    private static (float[] vertices, uint[] indices, uint flags) ReadGeometry(byte[] blob)
    {
        using var br = new BinaryReader(new MemoryStream(blob));

        Assert.Equal(ExpectedMagic, br.ReadUInt32());
        Assert.Equal(ExpectedVersion, br.ReadUInt32());

        var metadataLen = br.ReadUInt32();
        br.ReadBytes((int)metadataLen);

        var flags = br.ReadUInt32();
        var deltaEncoded = (flags & BinaryGeometryWriter.FlagDeltaEncoded) != 0;
        var originX = br.ReadDouble();
        var originY = br.ReadDouble();
        var originZ = br.ReadDouble();
        var scaleX = br.ReadDouble();
        var scaleY = br.ReadDouble();
        var scaleZ = br.ReadDouble();

        var vertexCount = br.ReadUInt32();
        var verts = new float[vertexCount * 3];

        if ((flags & BinaryGeometryWriter.FlagFloat32) != 0)
        {
            for (var i = 0; i < verts.Length; i++)
            {
                verts[i] = br.ReadSingle();
            }
        }
        else
        {
            short qx = 0, qy = 0, qz = 0;
            for (var i = 0; i < vertexCount; i++)
            {
                if (deltaEncoded)
                {
                    qx = unchecked((short)(qx + UnZigZag16(br.ReadUInt16())));
                    qy = unchecked((short)(qy + UnZigZag16(br.ReadUInt16())));
                    qz = unchecked((short)(qz + UnZigZag16(br.ReadUInt16())));
                }
                else
                {
                    qx = br.ReadInt16();
                    qy = br.ReadInt16();
                    qz = br.ReadInt16();
                }

                verts[i * 3] = (float)(originX + (qx + 32767) * scaleX);
                verts[i * 3 + 1] = (float)(originY + (qy + 32767) * scaleY);
                verts[i * 3 + 2] = (float)(originZ + (qz + 32767) * scaleZ);
            }
        }

        var indexCount = br.ReadUInt32();
        var indices = new uint[indexCount];
        var uint16Indices = (flags & BinaryGeometryWriter.FlagUint16Indices) != 0;
        if (uint16Indices)
        {
            ushort prev = 0;
            for (var i = 0; i < indexCount; i++)
            {
                prev = deltaEncoded ? unchecked((ushort)(prev + UnZigZag16(br.ReadUInt16()))) : br.ReadUInt16();
                indices[i] = prev;
            }
        }
        else
        {
            var prev = 0u;
            for (var i = 0; i < indexCount; i++)
            {
                prev = deltaEncoded ? unchecked((uint)((int)prev + UnZigZag32(br.ReadUInt32()))) : br.ReadUInt32();
                indices[i] = prev;
            }
        }

        return (verts, indices, flags);
    }

    private static short UnZigZag16(ushort zz)
    {
        return (short)((zz >> 1) ^ -(zz & 1));
    }

    private static int UnZigZag32(uint zz)
    {
        return (int)(zz >> 1) ^ -(int)(zz & 1);
    }
}
