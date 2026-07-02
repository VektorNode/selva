using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Decodes the SLVA/SLVZ mesh blob produced by <see cref="BinaryGeometryWriter" /> back into
///     world-space vertex and index arrays. This is the C# mirror of the web's <c>parseBinaryMeshBatch</c>,
///     used to rebuild drawable <see cref="Rhino.Geometry.Mesh" />es for the param's viewport preview
///     (the param holds only the encoded batch, not the original Rhino geometry).
///
///     Handles the optional <see cref="BlobCompressor" /> SLVZ wrapper transparently: a SLVZ blob is
///     inflated first, then parsed as SLVA.
/// </summary>
public static class BinaryGeometryReader
{
    /// <summary>Decoded geometry: the embedded metadata plus the combined world-space arrays.</summary>
    public sealed class Result
    {
        public DisplayBatch Metadata { get; set; }

        /// <summary>Flat world-space vertex components (x,y,z per vertex).</summary>
        public float[] Vertices { get; set; }

        /// <summary>Flat index array addressing the combined vertex array.</summary>
        public int[] Indices { get; set; }
    }

    public static Result Read(byte[] blob)
    {
        if (blob == null)
        {
            throw new ArgumentNullException(nameof(blob));
        }

        var bytes = MaybeDecompress(blob);

        using (var ms = new MemoryStream(bytes, false))
        using (var br = new BinaryReader(ms, Encoding.UTF8))
        {
            var magic = br.ReadUInt32();
            if (magic != BinaryGeometryWriter.Magic)
            {
                throw new InvalidDataException($"Not a SLVA blob (bad magic 0x{magic:X8}).");
            }

            br.ReadUInt32(); // version — layout is forward-compatible for the fields we read

            var metadataLen = br.ReadUInt32();
            var metadataJson = Encoding.UTF8.GetString(br.ReadBytes((int)metadataLen));
            var metadata = JsonConvert.DeserializeObject<DisplayBatch>(metadataJson) ?? new DisplayBatch();

            var flags = br.ReadUInt32();
            var useFloat32 = (flags & BinaryGeometryWriter.FlagFloat32) != 0;
            var useUint16Indices = (flags & BinaryGeometryWriter.FlagUint16Indices) != 0;
            var deltaEncoded = (flags & BinaryGeometryWriter.FlagDeltaEncoded) != 0;

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
                ushort prev = 0;
                for (var i = 0; i < indexCount; i++)
                {
                    prev = deltaEncoded
                        ? unchecked((ushort)(prev + UnZigZag16(br.ReadUInt16())))
                        : br.ReadUInt16();
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

            return new Result { Metadata = metadata, Vertices = vertices, Indices = indices };
        }
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

    /// <summary>
    ///     If the blob is a SLVZ container, inflate it back to the raw SLVA bytes; otherwise return
    ///     the input unchanged. Mirrors the web decoder's detection by leading magic.
    /// </summary>
    private static byte[] MaybeDecompress(byte[] blob)
    {
        if (blob.Length < 8 || BitConverter.ToUInt32(blob, 0) != BlobCompressor.CompressedMagic)
        {
            return blob;
        }

        var uncompressedLen = (int)BitConverter.ToUInt32(blob, 4);
        using (var input = new MemoryStream(blob, 8, blob.Length - 8))
        using (var deflate = new DeflateStream(input, CompressionMode.Decompress))
        using (var ms = new MemoryStream(uncompressedLen))
        {
            deflate.CopyTo(ms);
            return ms.ToArray();
        }
    }
}
