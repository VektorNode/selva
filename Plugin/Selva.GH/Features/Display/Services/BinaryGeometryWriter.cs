using System;
using System.Buffers;
using System.IO;
using System.Text;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Writes WebDisplay geometry in a compact binary format consumable directly as an
///     ArrayBuffer on the JS side. Replaces gzip+base64+JSON for the geometry payload.
/// </summary>
/// <remarks>
///     Wire format (little-endian throughout):
///
///     [4]  magic            = "SLVA" (0x53 0x4C 0x56 0x41)
///     [4]  version          = uint32 (currently 1)
///     [4]  metadataLen      = uint32 byte length of metadata JSON
///     [N]  metadata         = UTF-8 JSON (materials, groups, sourceComponentId, ...)
///
///     -- geometry block --
///     [4]  flags            = uint32 (bit 0: 0 = int16 quantized, 1 = float32 raw;
///                                     bit 1: 0 = uint32 indices, 1 = uint16 indices)
///     [24] origin           = 3 x float64
///     [24] scale            = 3 x float64 (step per int16 unit; identity for float32)
///     [4]  vertexCount      = uint32 number of vertices (positions = vertexCount * 3 components)
///     [V]  vertices         = int16[vertexCount*3]  OR  float32[vertexCount*3] depending on flags
///     [4]  indexCount       = uint32 number of indices
///     [I]  indices          = uint32[indexCount]  OR  uint16[indexCount] depending on flags
///
///     For int16: client reconstructs world position as origin + (q + 32767) * scale, where q is the
///     stored signed int16 in [-32767, 32767]. With scale = bboxSize / 65534 this maps the original
///     world bbox into the full int16 range symmetrically around 0, matching Three.js
///     `BufferAttribute(arr, 3, true)` (`normalized: true`) semantics.
///
///     For float32: origin = (0,0,0), scale = (1,1,1) and vertices are the raw world positions.
/// </remarks>
public static class BinaryGeometryWriter
{
    public const uint Magic = 0x41564C53; // "SLVA" little-endian
    public const uint Version = 2;

    public const uint FlagFloat32 = 0x1;

    /// <summary>
    ///     Bit 1 of the flags word: when set, indices are uint16 instead of uint32. Used when the
    ///     batch's total vertex count fits in 16 bits (≤ 65535), which halves the index payload —
    ///     usually the largest part of the blob for unwelded brep meshes.
    /// </summary>
    public const uint FlagUint16Indices = 0x2;

    /// <summary>Largest vertex index addressable by a uint16 index.</summary>
    private const int MaxUint16Index = 65535;

    /// <summary>
    ///     Smallest allowed scale on any axis. Prevents divide-by-zero on planar/degenerate batches
    ///     (e.g. all vertices share Z). Quantized values on the degenerate axis collapse to 0,
    ///     which is what we want.
    /// </summary>
    private const double ScaleEpsilon = 1e-12;

    /// <summary>
    ///     Default int16 step threshold (in world units) above which we fall back to float32.
    ///     Above this step the int16 grid is too coarse for visually-correct preview rendering.
    ///     Tune with measurement; v1 is conservative.
    /// </summary>
    private const double DefaultMaxInt16StepWorldUnits = 0.05; // 5 cm per int16 unit

    /// <summary>
    ///     Result of a write call. Returned as a struct so the caller can also surface diagnostics
    ///     (which format was used, what bbox was computed) without re-walking the vertex array.
    /// </summary>
    public struct WriteResult
    {
        public bool UsedFloat32;
        public bool UsedUint16Indices;
        public double OriginX, OriginY, OriginZ;
        public double ScaleX, ScaleY, ScaleZ;
        public int VertexCount;
        public int IndexCount;
    }

    /// <summary>
    ///     Writes a complete binary blob to <paramref name="output"/>. Caller owns the stream and is
    ///     responsible for disposing it.
    /// </summary>
    /// <param name="output">Destination stream. Written sequentially; no seek required.</param>
    /// <param name="metadataJson">UTF-8 JSON describing materials/groups/etc. May be empty but must not be null.</param>
    /// <param name="vertices">Flat array of x,y,z floats. Length must be divisible by 3.</param>
    /// <param name="indices">Flat array of vertex indices.</param>
    /// <param name="forceFloat32">If true, skip quantization and write float32 vertices.</param>
    public static WriteResult Write(
        Stream output,
        string metadataJson,
        float[] vertices,
        int[] indices,
        bool forceFloat32 = false)
    {
        if (output == null)
        {
            throw new ArgumentNullException(nameof(output));
        }

        if (metadataJson == null)
        {
            throw new ArgumentNullException(nameof(metadataJson));
        }

        if (vertices == null)
        {
            throw new ArgumentNullException(nameof(vertices));
        }

        if (indices == null)
        {
            throw new ArgumentNullException(nameof(indices));
        }

        if (vertices.Length % 3 != 0)
        {
            throw new ArgumentException("vertices length must be a multiple of 3 (x,y,z components)",
                nameof(vertices));
        }

        var vertexCount = vertices.Length / 3;
        var metadataBytes = Encoding.UTF8.GetBytes(metadataJson);

        // Compute bbox in a single pass. Unconditional even for float32, so the result struct can
        // surface it for callers that want to log/diagnose. Cost is one linear pass over vertices.
        ComputeBounds(vertices, out var minX, out var minY, out var minZ,
            out var maxX, out var maxY, out var maxZ);

        // Decide format. Empty mesh stays int16 (scales clamped to epsilon, all qs = 0).
        var useFloat32 = forceFloat32;
        if (!useFloat32 && vertexCount > 0)
        {
            var maxExtent = Math.Max(maxX - minX, Math.Max(maxY - minY, maxZ - minZ));
            var step = maxExtent / 65534.0;
            if (step > DefaultMaxInt16StepWorldUnits)
            {
                useFloat32 = true;
            }
        }

        double originX, originY, originZ, scaleX, scaleY, scaleZ;
        if (useFloat32)
        {
            originX = originY = originZ = 0.0;
            scaleX = scaleY = scaleZ = 1.0;
        }
        else
        {
            originX = minX;
            originY = minY;
            originZ = minZ;
            scaleX = Math.Max((maxX - minX) / 65534.0, ScaleEpsilon);
            scaleY = Math.Max((maxY - minY) / 65534.0, ScaleEpsilon);
            scaleZ = Math.Max((maxZ - minZ) / 65534.0, ScaleEpsilon);
        }

        // Indices address the combined vertex array, so the whole batch must fit in uint16 to use the
        // narrow path. vertexCount - 1 is the largest possible index value.
        var useUint16Indices = vertexCount > 0 && vertexCount - 1 <= MaxUint16Index;

        using (var writer = new BinaryWriter(output, Encoding.UTF8, leaveOpen: true))
        {
            // -- envelope --
            writer.Write(Magic);
            writer.Write(Version);
            writer.Write((uint)metadataBytes.Length);
            writer.Write(metadataBytes);

            // -- geometry block --
            var flags = 0u;
            if (useFloat32)
            {
                flags |= FlagFloat32;
            }

            if (useUint16Indices)
            {
                flags |= FlagUint16Indices;
            }

            writer.Write(flags);
            writer.Write(originX);
            writer.Write(originY);
            writer.Write(originZ);
            writer.Write(scaleX);
            writer.Write(scaleY);
            writer.Write(scaleZ);

            writer.Write((uint)vertexCount);
            if (useFloat32)
            {
                WriteFloat32Vertices(output, vertices);
            }
            else
            {
                WriteInt16Vertices(output, vertices, originX, originY, originZ,
                    scaleX, scaleY, scaleZ);
            }

            writer.Write((uint)indices.Length);
            if (useUint16Indices)
            {
                WriteUInt16Indices(output, indices);
            }
            else
            {
                WriteUInt32Indices(output, indices);
            }
        }

        return new WriteResult
        {
            UsedFloat32 = useFloat32,
            UsedUint16Indices = useUint16Indices,
            OriginX = originX,
            OriginY = originY,
            OriginZ = originZ,
            ScaleX = scaleX,
            ScaleY = scaleY,
            ScaleZ = scaleZ,
            VertexCount = vertexCount,
            IndexCount = indices.Length
        };
    }

    private static void ComputeBounds(
        float[] vertices,
        out double minX, out double minY, out double minZ,
        out double maxX, out double maxY, out double maxZ)
    {
        if (vertices.Length == 0)
        {
            minX = minY = minZ = 0.0;
            maxX = maxY = maxZ = 0.0;
            return;
        }

        minX = maxX = vertices[0];
        minY = maxY = vertices[1];
        minZ = maxZ = vertices[2];

        for (var i = 3; i < vertices.Length; i += 3)
        {
            var x = vertices[i];
            var y = vertices[i + 1];
            var z = vertices[i + 2];

            if (x < minX) minX = x; else if (x > maxX) maxX = x;
            if (y < minY) minY = y; else if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; else if (z > maxZ) maxZ = z;
        }
    }

    private static void WriteInt16Vertices(
        Stream output, float[] vertices,
        double originX, double originY, double originZ,
        double scaleX, double scaleY, double scaleZ)
    {
        var vertexCount = vertices.Length / 3;
        var byteCount = vertexCount * 3 * sizeof(short);
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            var bi = 0;
            for (var i = 0; i < vertices.Length; i += 3)
            {
                // Quantize to [-32767, 32767]. (max-min)/scale = 65534, then subtract 32767 to center.
                var qx = (short)(Math.Round((vertices[i] - originX) / scaleX) - 32767);
                var qy = (short)(Math.Round((vertices[i + 1] - originY) / scaleY) - 32767);
                var qz = (short)(Math.Round((vertices[i + 2] - originZ) / scaleZ) - 32767);

                buffer[bi++] = (byte)(qx & 0xFF);
                buffer[bi++] = (byte)((qx >> 8) & 0xFF);
                buffer[bi++] = (byte)(qy & 0xFF);
                buffer[bi++] = (byte)((qy >> 8) & 0xFF);
                buffer[bi++] = (byte)(qz & 0xFF);
                buffer[bi++] = (byte)((qz >> 8) & 0xFF);
            }

            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static void WriteFloat32Vertices(Stream output, float[] vertices)
    {
        var byteCount = vertices.Length * sizeof(float);
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            Buffer.BlockCopy(vertices, 0, buffer, 0, byteCount);
            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static void WriteUInt16Indices(Stream output, int[] indices)
    {
        var byteCount = indices.Length * sizeof(ushort);
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            var bi = 0;
            foreach (var index in indices)
            {
                var u = (ushort)index;
                buffer[bi++] = (byte)(u & 0xFF);
                buffer[bi++] = (byte)((u >> 8) & 0xFF);
            }

            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static void WriteUInt32Indices(Stream output, int[] indices)
    {
        var byteCount = indices.Length * sizeof(uint);
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            Buffer.BlockCopy(indices, 0, buffer, 0, byteCount);
            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }
}
