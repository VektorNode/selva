using System.IO;
using System.Text;
using Selva.Slva;

namespace Selva.Tests;

/// <summary>
///     Test-local SLVA decoder, deliberately independent of both production decoders (the TS
///     parser and <c>BinaryGeometryReader</c>) so a shared decode bug can't hide from its own
///     test. Decodes every format version through the flag-driven read path, so the same code
///     checks current-writer output and the frozen v3 fixtures.
/// </summary>
internal static class SlvaTestDecoder
{
    internal sealed class DecodedBlob
    {
        public uint Version;
        public string MetadataJson = "";
        public float[] Vertices = null!;
        public uint[] Indices = null!;
        public uint Flags;
        public float[]? Uvs;
        public byte[]? Colors;

        /// <summary>Bytes consumed by the decode — equals blob length iff nothing trails the format.</summary>
        public long BytesConsumed;
    }

    /// <summary>
    ///     Undoes the SLVZ container (magic + uncompressedLen + raw DEFLATE). BlobCompressor only
    ///     compresses — the production decoder is TS — so tests inflate locally. Non-SLVZ input
    ///     passes through, matching the decoder's magic-sniffing.
    /// </summary>
    internal static byte[] DecompressIfSlvz(byte[] bytes)
    {
        if (bytes.Length < 8 || System.BitConverter.ToUInt32(bytes, 0) != BlobCompressor.CompressedMagic)
        {
            return bytes;
        }

        var uncompressedLen = System.BitConverter.ToUInt32(bytes, 4);
        using var input = new MemoryStream(bytes, 8, bytes.Length - 8);
        using var deflate = new System.IO.Compression.DeflateStream(
            input, System.IO.Compression.CompressionMode.Decompress);
        using var output = new MemoryStream((int)uncompressedLen);
        deflate.CopyTo(output);
        return output.ToArray();
    }

    internal static DecodedBlob ReadAll(byte[] blob)
    {
        using var ms = new MemoryStream(blob);
        using var br = new BinaryReader(ms);

        Assert.Equal(BinaryGeometryWriter.Magic, br.ReadUInt32());
        var version = br.ReadUInt32();
        Assert.InRange(version, 1u, BinaryGeometryWriter.Version);

        var metadataLen = br.ReadUInt32();
        var metadataJson = Encoding.UTF8.GetString(br.ReadBytes((int)metadataLen));

        var flags = br.ReadUInt32();
        var deltaEncoded = (flags & BinaryGeometryWriter.FlagDeltaEncoded) != 0;
        var planar = (flags & BinaryGeometryWriter.FlagPlanarByteSplit) != 0;
        var originX = br.ReadDouble();
        var originY = br.ReadDouble();
        var originZ = br.ReadDouble();
        var scaleX = br.ReadDouble();
        var scaleY = br.ReadDouble();
        var scaleZ = br.ReadDouble();

        var vertexCount = (int)br.ReadUInt32();
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
            var n = vertexCount;
            var block = planar ? br.ReadBytes(n * 6) : null;
            short qx = 0, qy = 0, qz = 0;
            for (var i = 0; i < n; i++)
            {
                if (planar)
                {
                    // v4: [Xlo][Ylo][Zlo][Xhi][Yhi][Zhi] byte planes of the zigzag deltas.
                    qx = unchecked((short)(qx + UnZigZag16((ushort)(block![i] | (block[n * 3 + i] << 8)))));
                    qy = unchecked((short)(qy + UnZigZag16((ushort)(block[n + i] | (block[n * 4 + i] << 8)))));
                    qz = unchecked((short)(qz + UnZigZag16((ushort)(block[n * 2 + i] | (block[n * 5 + i] << 8)))));
                }
                else if (deltaEncoded)
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

        var indexCount = (int)br.ReadUInt32();
        var indices = new uint[indexCount];
        var uint16Indices = (flags & BinaryGeometryWriter.FlagUint16Indices) != 0;
        if (uint16Indices)
        {
            var block = planar ? br.ReadBytes(indexCount * 2) : null;
            ushort prev = 0;
            for (var i = 0; i < indexCount; i++)
            {
                var zz = planar
                    ? (ushort)(block![i] | (block[indexCount + i] << 8))
                    : br.ReadUInt16();
                prev = deltaEncoded ? unchecked((ushort)(prev + UnZigZag16(zz))) : zz;
                indices[i] = prev;
            }
        }
        else
        {
            var block = planar ? br.ReadBytes(indexCount * 4) : null;
            var prev = 0u;
            for (var i = 0; i < indexCount; i++)
            {
                var zz = planar
                    ? (uint)(block![i] | (block[indexCount + i] << 8)
                             | (block[indexCount * 2 + i] << 16) | (block[indexCount * 3 + i] << 24))
                    : br.ReadUInt32();
                prev = deltaEncoded ? unchecked((uint)((int)prev + UnZigZag32(zz))) : zz;
                indices[i] = prev;
            }
        }

        float[]? uvs = null;
        if ((flags & BinaryGeometryWriter.FlagHasUvs) != 0)
        {
            var uvFormat = br.ReadUInt32();
            var originU = br.ReadDouble();
            var originV = br.ReadDouble();
            var scaleU = br.ReadDouble();
            var scaleV = br.ReadDouble();

            uvs = new float[vertexCount * 2];
            if (uvFormat == BinaryGeometryWriter.UvFormatFloat32)
            {
                for (var i = 0; i < uvs.Length; i++)
                {
                    uvs[i] = br.ReadSingle();
                }
            }
            else
            {
                var n = vertexCount;
                var block = planar ? br.ReadBytes(n * 4) : null;
                ushort qu = 0, qv = 0;
                for (var i = 0; i < n; i++)
                {
                    if (planar)
                    {
                        // v4: [Ulo][Vlo][Uhi][Vhi] byte planes of the zigzag deltas.
                        qu = unchecked((ushort)(qu + UnZigZag16((ushort)(block![i] | (block[n * 2 + i] << 8)))));
                        qv = unchecked((ushort)(qv + UnZigZag16((ushort)(block[n + i] | (block[n * 3 + i] << 8)))));
                    }
                    else if (deltaEncoded)
                    {
                        qu = unchecked((ushort)(qu + UnZigZag16(br.ReadUInt16())));
                        qv = unchecked((ushort)(qv + UnZigZag16(br.ReadUInt16())));
                    }
                    else
                    {
                        qu = br.ReadUInt16();
                        qv = br.ReadUInt16();
                    }

                    uvs[i * 2] = (float)(originU + qu * scaleU);
                    uvs[i * 2 + 1] = (float)(originV + qv * scaleV);
                }
            }
        }

        byte[]? colors = null;
        if ((flags & BinaryGeometryWriter.FlagHasVertexColors) != 0)
        {
            colors = new byte[vertexCount * 3];
            byte r = 0, g = 0, b = 0;
            for (var i = 0; i < vertexCount; i++)
            {
                if (deltaEncoded)
                {
                    r = unchecked((byte)(r + UnZigZag8(br.ReadByte())));
                    g = unchecked((byte)(g + UnZigZag8(br.ReadByte())));
                    b = unchecked((byte)(b + UnZigZag8(br.ReadByte())));
                }
                else
                {
                    r = br.ReadByte();
                    g = br.ReadByte();
                    b = br.ReadByte();
                }

                colors[i * 3] = r;
                colors[i * 3 + 1] = g;
                colors[i * 3 + 2] = b;
            }
        }

        return new DecodedBlob
        {
            Version = version,
            MetadataJson = metadataJson,
            Vertices = verts,
            Indices = indices,
            Flags = flags,
            Uvs = uvs,
            Colors = colors,
            BytesConsumed = ms.Position
        };
    }

    /// <summary>Inverse of the writer's zigzag map: 0,1,2,3 → 0,-1,1,-2.</summary>
    private static short UnZigZag16(ushort zz)
    {
        return (short)((zz >> 1) ^ -(zz & 1));
    }

    private static int UnZigZag32(uint zz)
    {
        return (int)(zz >> 1) ^ -(int)(zz & 1);
    }

    private static sbyte UnZigZag8(byte zz)
    {
        return (sbyte)((zz >> 1) ^ -(zz & 1));
    }
}
