using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     Decodes the SLVA/SLVZ mesh blob produced by <see cref="SlvaWriter" /> back into
///     world-space vertex and index arrays. This is the C# mirror of the web's <c>parseBinaryMeshBatch</c>,
///     used to rebuild drawable <c>Rhino.Geometry.Mesh</c>es for the param's viewport preview
///     (the param holds only the encoded batch, not the original Rhino geometry).
///
///     Handles the optional <see cref="SlvzCompressor" /> SLVZ wrapper transparently: a SLVZ blob is
///     inflated first, then parsed as SLVA.
/// </summary>
public static class SlvaReader
{
    /// <summary>Decoded geometry: the embedded metadata plus the combined world-space arrays.</summary>
    public sealed class Result
    {
        public DisplayBatch Metadata { get; set; }

        /// <summary>Flat world-space vertex components (x,y,z per vertex).</summary>
        public float[] Vertices { get; set; }

        /// <summary>Flat index array addressing the combined vertex array.</summary>
        public int[] Indices { get; set; }

        /// <summary>Flat dequantized UV components (u,v per vertex); null when the blob has no UV chunk.</summary>
        public float[] Uvs { get; set; }

        /// <summary>Flat vertex colors (r,g,b per vertex); null when the blob has no color chunk.</summary>
        public byte[] Colors { get; set; }
    }

    public static Result Read(byte[] blob)
    {
        if (blob == null)
        {
            throw new ArgumentNullException(nameof(blob));
        }

        // An SLVM v3 container carries its object table in TABL and its geometry as a nested
        // bare blob — unwrap, decode the inner blob, and overlay the container's metadata.
        if (SlvmDocument.IsSlvm(blob))
        {
            var doc = SlvmDocument.Read(blob);
            var inner = Read(doc.GeometryBlob);
            inner.Metadata = doc.Batch;
            return inner;
        }

        var bytes = SlvzCompressor.MaybeDecompress(blob);

        using (var ms = new MemoryStream(bytes, false))
        using (var br = new BinaryReader(ms, Encoding.UTF8))
        {
            var magic = br.ReadUInt32();
            if (magic != SlvaWriter.Magic)
            {
                throw new InvalidDataException($"Not a SLVA blob (bad magic 0x{magic:X8}).");
            }

            br.ReadUInt32(); // version — layout is forward-compatible for the fields we read

            var metadataLen = br.ReadUInt32();
            var metadataJson = Encoding.UTF8.GetString(br.ReadBytes((int)metadataLen));
            var metadata = JsonConvert.DeserializeObject<DisplayBatch>(metadataJson) ?? new DisplayBatch();

            var flags = br.ReadUInt32();
            var useFloat32 = (flags & SlvaWriter.FlagFloat32) != 0;
            var useUint16Indices = (flags & SlvaWriter.FlagUint16Indices) != 0;
            var deltaEncoded = (flags & SlvaWriter.FlagDeltaEncoded) != 0;
            var planar = (flags & SlvaWriter.FlagPlanarByteSplit) != 0;
            var hasUvs = (flags & SlvaWriter.FlagHasUvs) != 0;
            var hasColors = (flags & SlvaWriter.FlagHasVertexColors) != 0;

            var originX = br.ReadDouble();
            var originY = br.ReadDouble();
            var originZ = br.ReadDouble();
            var scaleX = br.ReadDouble();
            var scaleY = br.ReadDouble();
            var scaleZ = br.ReadDouble();

            var vertexCount = (int)br.ReadUInt32();
            var componentCount = vertexCount * 3;
            var vertices = new float[componentCount];

            if (useFloat32)
            {
                for (var i = 0; i < componentCount; i++)
                {
                    vertices[i] = br.ReadSingle();
                }
            }
            else if (planar)
            {
                // v4 layout: six byte planes ([Xlo][Ylo][Zlo][Xhi][Yhi][Zhi], each vertexCount
                // bytes) of the zigzag deltas — read the block, merge planes, prefix-sum.
                var block = br.ReadBytes(vertexCount * 6);
                short qx = 0, qy = 0, qz = 0;
                for (var i = 0; i < vertexCount; i++)
                {
                    qx = unchecked((short)(qx + UnZigZag16((ushort)(block[i] | (block[vertexCount * 3 + i] << 8)))));
                    qy = unchecked((short)(qy + UnZigZag16((ushort)(block[vertexCount + i] | (block[vertexCount * 4 + i] << 8)))));
                    qz = unchecked((short)(qz + UnZigZag16((ushort)(block[vertexCount * 2 + i] | (block[vertexCount * 5 + i] << 8)))));

                    vertices[i * 3] = (float)(originX + (qx + 32767) * scaleX);
                    vertices[i * 3 + 1] = (float)(originY + (qy + 32767) * scaleY);
                    vertices[i * 3 + 2] = (float)(originZ + (qz + 32767) * scaleZ);
                }
            }
            else
            {
                // Inverse of the writer's quantization: world = origin + (q + 32767) * scale.
                // v3 blobs store per-component zigzag deltas; undo the filter with a prefix sum.
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

                    vertices[i * 3] = (float)(originX + (qx + 32767) * scaleX);
                    vertices[i * 3 + 1] = (float)(originY + (qy + 32767) * scaleY);
                    vertices[i * 3 + 2] = (float)(originZ + (qz + 32767) * scaleZ);
                }
            }

            var indexCount = (int)br.ReadUInt32();
            var indices = new int[indexCount];
            if (useUint16Indices)
            {
                if (planar)
                {
                    var block = br.ReadBytes(indexCount * 2);
                    ushort prev = 0;
                    for (var i = 0; i < indexCount; i++)
                    {
                        prev = unchecked((ushort)(prev + UnZigZag16((ushort)(block[i] | (block[indexCount + i] << 8)))));
                        indices[i] = prev;
                    }
                }
                else
                {
                    ushort prev = 0;
                    for (var i = 0; i < indexCount; i++)
                    {
                        prev = deltaEncoded
                            ? unchecked((ushort)(prev + UnZigZag16(br.ReadUInt16())))
                            : br.ReadUInt16();
                        indices[i] = prev;
                    }
                }
            }
            else if (planar)
            {
                var block = br.ReadBytes(indexCount * 4);
                var prev = 0;
                for (var i = 0; i < indexCount; i++)
                {
                    var zz = (uint)(block[i]
                                    | (block[indexCount + i] << 8)
                                    | (block[indexCount * 2 + i] << 16)
                                    | (block[indexCount * 3 + i] << 24));
                    prev = unchecked(prev + UnZigZag32(zz));
                    indices[i] = prev;
                }
            }
            else
            {
                var prev = 0;
                for (var i = 0; i < indexCount; i++)
                {
                    prev = deltaEncoded
                        ? unchecked(prev + UnZigZag32(br.ReadUInt32()))
                        : (int)br.ReadUInt32();
                    indices[i] = prev;
                }
            }

            // Trailing chunks (UV first, then colors) — see the writer's class remarks for layout.
            float[] uvs = null;
            if (hasUvs)
            {
                uvs = ReadUvChunk(br, vertexCount, deltaEncoded, planar);
            }

            byte[] colors = null;
            if (hasColors)
            {
                colors = ReadColorChunk(br, vertexCount, deltaEncoded);
            }

            return new Result
            {
                Metadata = metadata,
                Vertices = vertices,
                Indices = indices,
                Uvs = uvs,
                Colors = colors
            };
        }
    }

    private static float[] ReadUvChunk(BinaryReader br, int vertexCount, bool deltaEncoded, bool planar)
    {
        var uvFormat = br.ReadUInt32();
        var originU = br.ReadDouble();
        var originV = br.ReadDouble();
        var scaleU = br.ReadDouble();
        var scaleV = br.ReadDouble();

        var uvs = new float[vertexCount * 2];
        if (uvFormat == SlvaWriter.UvFormatFloat32)
        {
            for (var i = 0; i < uvs.Length; i++)
            {
                uvs[i] = br.ReadSingle();
            }

            return uvs;
        }

        if (planar)
        {
            // v4 layout: [Ulo][Vlo][Uhi][Vhi], each vertexCount bytes.
            var block = br.ReadBytes(vertexCount * 4);
            ushort pu = 0, pv = 0;
            for (var i = 0; i < vertexCount; i++)
            {
                pu = unchecked((ushort)(pu + UnZigZag16((ushort)(block[i] | (block[vertexCount * 2 + i] << 8)))));
                pv = unchecked((ushort)(pv + UnZigZag16((ushort)(block[vertexCount + i] | (block[vertexCount * 3 + i] << 8)))));
                uvs[i * 2] = (float)(originU + pu * scaleU);
                uvs[i * 2 + 1] = (float)(originV + pv * scaleV);
            }

            return uvs;
        }

        // Unsigned quantization: uv = origin + q * scale, delta+zigzag filtered per component
        // (independent u/v predictors) when the blob-wide delta flag is set.
        ushort qu = 0, qv = 0;
        for (var i = 0; i < vertexCount; i++)
        {
            if (deltaEncoded)
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

        return uvs;
    }

    private static byte[] ReadColorChunk(BinaryReader br, int vertexCount, bool deltaEncoded)
    {
        var colors = new byte[vertexCount * 3];
        if (!deltaEncoded)
        {
            for (var i = 0; i < colors.Length; i++)
            {
                colors[i] = br.ReadByte();
            }

            return colors;
        }

        byte r = 0, g = 0, b = 0;
        for (var i = 0; i < vertexCount; i++)
        {
            r = unchecked((byte)(r + UnZigZag8(br.ReadByte())));
            g = unchecked((byte)(g + UnZigZag8(br.ReadByte())));
            b = unchecked((byte)(b + UnZigZag8(br.ReadByte())));

            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }

        return colors;
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
