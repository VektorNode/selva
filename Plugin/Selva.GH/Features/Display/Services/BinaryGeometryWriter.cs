using System;
using System.Buffers;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Writes WebDisplay geometry in a compact binary format consumable directly as an
///     ArrayBuffer on the JS side. Replaces gzip+base64+JSON for the geometry payload.
/// </summary>
/// <remarks>
///     Wire format (little-endian throughout):
///
///     [4]  magic            = "SLVA" (0x53 0x4C 0x56 0x41)
///     [4]  version          = uint32 (currently 3; v2 added uint16 indices, v3 the delta filter)
///     [4]  metadataLen      = uint32 byte length of metadata JSON
///     [N]  metadata         = UTF-8 JSON (materials, groups, sourceComponentId, ...)
///
///     -- geometry block --
///     [4]  flags            = uint32 (bit 0: 0 = int16 quantized, 1 = float32 raw;
///                                     bit 1: 0 = uint32 indices, 1 = uint16 indices;
///                                     bit 2: 1 = delta+zigzag filtered, see below)
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
///
///     Delta filter (v3, <see cref="FlagDeltaEncoded" />): quantized vertex components are stored as
///     the wrapped 16-bit difference from the previous vertex's same component (independent x/y/z
///     predictors), zigzag-mapped to unsigned; indices likewise as the wrapped difference from the
///     previous index, in their native width. This is a PNG-style pre-filter: welded meshes have
///     spatially-local vertices and locally-clustered indices, so deltas concentrate near zero and
///     the downstream <see cref="BlobCompressor" /> DEFLATE pass compresses far better. Float32
///     vertices are never filtered. Wrapping arithmetic keeps the filter lossless for any input;
///     the decoder reverses it with a running prefix sum.
///
///     Optional trailing chunks (still version 3 — readers ignore trailing bytes, so pre-chunk
///     decoders render these blobs untextured/uncolored instead of rejecting them). Appended after
///     the index block, UV chunk first; element counts are implied by vertexCount:
///
///     UV chunk (<see cref="FlagHasUvs" />, bit 3):
///     [4]  uvFormat  = uint32 (0 = uint16 quantized, 1 = float32 raw)
///     [16] uvOrigin  = 2 x float64
///     [16] uvScale   = 2 x float64 (step per uint16 unit; identity for float32)
///     [U]  uvs       = uint16[vertexCount*2]  OR  float32[vertexCount*2]
///
///     Quantized UVs are unsigned: uv = origin + q * scale with q in [0, 65535] and
///     scale = extent / 65535. When any axis' step exceeds <see cref="MaxUvQuantizationStep" />
///     (heavily tiled UVs) the chunk falls back to float32. Quantized UVs are delta+zigzag
///     filtered per component (independent u/v predictors) iff <see cref="FlagDeltaEncoded" />
///     is set; float32 UVs are never filtered.
///
///     Color chunk (<see cref="FlagHasVertexColors" />, bit 4):
///     [C]  colors    = uint8[vertexCount*3] (r,g,b; alpha is not carried)
///
///     Colors are delta+zigzag filtered per channel (wrapped 8-bit, independent r/g/b predictors)
///     iff <see cref="FlagDeltaEncoded" /> is set — analysis gradients concentrate near zero.
/// </remarks>
public static class BinaryGeometryWriter
{
    public const uint Magic = 0x41564C53; // "SLVA" little-endian
    public const uint Version = 3;

    public const uint FlagFloat32 = 0x1;

    /// <summary>Bit 1: indices are uint16 instead of uint32 (halves the index payload).</summary>
    public const uint FlagUint16Indices = 0x2;

    /// <summary>
    ///     Bit 2: vertices/indices are delta+zigzag filtered. Always set by the v3 writer; exists so
    ///     decoders handle pre-v3 blobs (persisted .gh params, mesh files) through the same read path.
    /// </summary>
    public const uint FlagDeltaEncoded = 0x4;

    /// <summary>Bit 3: a UV chunk follows the index block.</summary>
    public const uint FlagHasUvs = 0x8;

    /// <summary>Bit 4: a vertex-color chunk follows the index block (after UVs, if both present).</summary>
    public const uint FlagHasVertexColors = 0x10;

    /// <summary>uvFormat value: uint16 quantized UVs (origin/scale reconstruct the range).</summary>
    public const uint UvFormatUint16 = 0;

    /// <summary>uvFormat value: raw float32 UVs (origin = 0, scale = 1).</summary>
    public const uint UvFormatFloat32 = 1;

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
    ///     UV quantization step above which the UV chunk falls back to float32. A step of 1/4096
    ///     keeps quantization error below one texel on a 4K texture; UVs spanning more than
    ///     ~16 tile repeats (extent > 65535/4096) exceed it and go raw.
    /// </summary>
    private const double MaxUvQuantizationStep = 1.0 / 4096.0;

    /// <summary>
    ///     Result of a write call. Returned as a struct so the caller can also surface diagnostics
    ///     (which format was used, what bbox was computed) without re-walking the vertex array.
    /// </summary>
    public struct WriteResult
    {
        public bool UsedFloat32;
        public bool UsedUint16Indices;
        public bool UsedFloat32Uvs;
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
    /// <param name="uvs">
    ///     Optional flat array of u,v floats, one pair per vertex (length vertexCount * 2). Null
    ///     writes no UV chunk and leaves the blob byte-identical to a UV-less write.
    /// </param>
    /// <param name="colors">
    ///     Optional flat array of r,g,b bytes, one triple per vertex (length vertexCount * 3).
    ///     Null writes no color chunk.
    /// </param>
    public static WriteResult Write(
        Stream output,
        string metadataJson,
        float[] vertices,
        int[] indices,
        bool forceFloat32 = false,
        float[] uvs = null,
        byte[] colors = null)
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

        if (uvs != null && uvs.Length != vertexCount * 2)
        {
            throw new ArgumentException(
                $"uvs length must be vertexCount * 2 ({vertexCount * 2}), got {uvs.Length}",
                nameof(uvs));
        }

        if (colors != null && colors.Length != vertexCount * 3)
        {
            throw new ArgumentException(
                $"colors length must be vertexCount * 3 ({vertexCount * 3}), got {colors.Length}",
                nameof(colors));
        }

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

        // UV quantization mirrors positions: origin = min, scale = extent/65535, with a float32
        // fallback when the step is too coarse (heavily tiled UVs).
        var useFloat32Uvs = false;
        double uvOriginU = 0.0, uvOriginV = 0.0, uvScaleU = 1.0, uvScaleV = 1.0;
        if (uvs != null && uvs.Length > 0)
        {
            ComputeUvBounds(uvs, out var minU, out var minV, out var maxU, out var maxV);
            useFloat32Uvs = (maxU - minU) / 65535.0 > MaxUvQuantizationStep
                            || (maxV - minV) / 65535.0 > MaxUvQuantizationStep;
            if (!useFloat32Uvs)
            {
                uvOriginU = minU;
                uvOriginV = minV;
                uvScaleU = Math.Max((maxU - minU) / 65535.0, ScaleEpsilon);
                uvScaleV = Math.Max((maxV - minV) / 65535.0, ScaleEpsilon);
            }
        }

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

            flags |= FlagDeltaEncoded;

            if (uvs != null)
            {
                flags |= FlagHasUvs;
            }

            if (colors != null)
            {
                flags |= FlagHasVertexColors;
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
                WriteFloat32Components(output, vertices);
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

            // Trailing chunks (UV first, then colors). Old decoders return right after the index
            // block, so these degrade gracefully; when both params are null the blob is
            // byte-identical to a chunk-less write.
            if (uvs != null)
            {
                writer.Write(useFloat32Uvs ? UvFormatFloat32 : UvFormatUint16);
                writer.Write(uvOriginU);
                writer.Write(uvOriginV);
                writer.Write(uvScaleU);
                writer.Write(uvScaleV);
                if (useFloat32Uvs)
                {
                    WriteFloat32Components(output, uvs);
                }
                else
                {
                    WriteUInt16Uvs(output, uvs, uvOriginU, uvOriginV, uvScaleU, uvScaleV);
                }
            }

            if (colors != null)
            {
                WriteColors(output, colors);
            }
        }

        return new WriteResult
        {
            UsedFloat32 = useFloat32,
            UsedUint16Indices = useUint16Indices,
            UsedFloat32Uvs = useFloat32Uvs,
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

    /// <summary>
    ///     Vertex-component count above which the bbox pass is split across threads. Below it the
    ///     partitioning overhead outweighs a single linear scan.
    /// </summary>
    private const int ParallelBoundsMinComponents = 200_000;

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

        if (vertices.Length >= ParallelBoundsMinComponents)
        {
            ComputeBoundsParallel(vertices, out minX, out minY, out minZ, out maxX, out maxY, out maxZ);
            return;
        }

        ComputeBoundsRange(vertices, 0, vertices.Length / 3,
            out minX, out minY, out minZ, out maxX, out maxY, out maxZ);
    }

    /// <summary>
    ///     Same result as the serial scan, computed as a partitioned min/max reduction. Exact
    ///     (min/max are associative and the inputs are floats widened to double, so there is no
    ///     summation drift), which matters: the bbox becomes the quantization origin/scale, and a
    ///     partition-order-dependent bbox would make blob bytes non-deterministic.
    /// </summary>
    private static void ComputeBoundsParallel(
        float[] vertices,
        out double minX, out double minY, out double minZ,
        out double maxX, out double maxY, out double maxZ)
    {
        var vertexCount = vertices.Length / 3;
        var partitions = Math.Min(Environment.ProcessorCount, Math.Max(1, vertexCount / 32_768));
        if (partitions < 2)
        {
            ComputeBoundsRange(vertices, 0, vertexCount,
                out minX, out minY, out minZ, out maxX, out maxY, out maxZ);
            return;
        }

        var perPartition = (vertexCount + partitions - 1) / partitions;
        var results = new double[partitions * 6];

        Parallel.For(0, partitions, p =>
        {
            var start = p * perPartition;
            var end = Math.Min(start + perPartition, vertexCount);
            if (start >= end)
            {
                // Empty tail partition: seed with values that lose every comparison in the merge.
                results[p * 6] = results[p * 6 + 1] = results[p * 6 + 2] = double.PositiveInfinity;
                results[p * 6 + 3] = results[p * 6 + 4] = results[p * 6 + 5] = double.NegativeInfinity;
                return;
            }

            ComputeBoundsRange(vertices, start, end,
                out var pMinX, out var pMinY, out var pMinZ,
                out var pMaxX, out var pMaxY, out var pMaxZ);

            results[p * 6] = pMinX;
            results[p * 6 + 1] = pMinY;
            results[p * 6 + 2] = pMinZ;
            results[p * 6 + 3] = pMaxX;
            results[p * 6 + 4] = pMaxY;
            results[p * 6 + 5] = pMaxZ;
        });

        minX = results[0];
        minY = results[1];
        minZ = results[2];
        maxX = results[3];
        maxY = results[4];
        maxZ = results[5];

        for (var p = 1; p < partitions; p++)
        {
            var o = p * 6;
            if (results[o] < minX) minX = results[o];
            if (results[o + 1] < minY) minY = results[o + 1];
            if (results[o + 2] < minZ) minZ = results[o + 2];
            if (results[o + 3] > maxX) maxX = results[o + 3];
            if (results[o + 4] > maxY) maxY = results[o + 4];
            if (results[o + 5] > maxZ) maxZ = results[o + 5];
        }
    }

    /// <summary>Scans vertices in [<paramref name="startVertex" />, <paramref name="endVertex" />).</summary>
    private static void ComputeBoundsRange(
        float[] vertices, int startVertex, int endVertex,
        out double minX, out double minY, out double minZ,
        out double maxX, out double maxY, out double maxZ)
    {
        var i = startVertex * 3;
        minX = maxX = vertices[i];
        minY = maxY = vertices[i + 1];
        minZ = maxZ = vertices[i + 2];

        var end = endVertex * 3;
        for (i += 3; i < end; i += 3)
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
            short prevX = 0, prevY = 0, prevZ = 0;
            for (var i = 0; i < vertices.Length; i += 3)
            {
                // Quantize to [-32767, 32767]. (max-min)/scale = 65534, then subtract 32767 to center.
                var qx = (short)(Math.Round((vertices[i] - originX) / scaleX) - 32767);
                var qy = (short)(Math.Round((vertices[i + 1] - originY) / scaleY) - 32767);
                var qz = (short)(Math.Round((vertices[i + 2] - originZ) / scaleZ) - 32767);

                // Delta filter: wrapped 16-bit difference from the previous vertex, zigzag-mapped so
                // small ± deltas become small unsigned values DEFLATE compresses well.
                var zx = ZigZag16(unchecked((short)(qx - prevX)));
                var zy = ZigZag16(unchecked((short)(qy - prevY)));
                var zz = ZigZag16(unchecked((short)(qz - prevZ)));
                prevX = qx;
                prevY = qy;
                prevZ = qz;

                buffer[bi++] = (byte)(zx & 0xFF);
                buffer[bi++] = (byte)(zx >> 8);
                buffer[bi++] = (byte)(zy & 0xFF);
                buffer[bi++] = (byte)(zy >> 8);
                buffer[bi++] = (byte)(zz & 0xFF);
                buffer[bi++] = (byte)(zz >> 8);
            }

            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <summary>Writes raw float32 components (positions or UVs) without any filtering.</summary>
    private static void WriteFloat32Components(Stream output, float[] components)
    {
        var byteCount = components.Length * sizeof(float);
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            Buffer.BlockCopy(components, 0, buffer, 0, byteCount);
            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static void ComputeUvBounds(
        float[] uvs,
        out double minU, out double minV,
        out double maxU, out double maxV)
    {
        minU = maxU = uvs[0];
        minV = maxV = uvs[1];

        for (var i = 2; i < uvs.Length; i += 2)
        {
            var u = uvs[i];
            var v = uvs[i + 1];

            if (u < minU) minU = u; else if (u > maxU) maxU = u;
            if (v < minV) minV = v; else if (v > maxV) maxV = v;
        }
    }

    private static void WriteUInt16Uvs(
        Stream output, float[] uvs,
        double originU, double originV,
        double scaleU, double scaleV)
    {
        var byteCount = uvs.Length * sizeof(ushort);
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            var bi = 0;
            ushort prevU = 0, prevV = 0;
            for (var i = 0; i < uvs.Length; i += 2)
            {
                // Unsigned quantization: q in [0, 65535], uv = origin + q * scale. Clamp guards
                // rounding at the extent boundary.
                var qu = (ushort)Math.Min(Math.Max(Math.Round((uvs[i] - originU) / scaleU), 0.0), 65535.0);
                var qv = (ushort)Math.Min(Math.Max(Math.Round((uvs[i + 1] - originV) / scaleV), 0.0), 65535.0);

                var zu = ZigZag16(unchecked((short)(qu - prevU)));
                var zv = ZigZag16(unchecked((short)(qv - prevV)));
                prevU = qu;
                prevV = qv;

                buffer[bi++] = (byte)(zu & 0xFF);
                buffer[bi++] = (byte)(zu >> 8);
                buffer[bi++] = (byte)(zv & 0xFF);
                buffer[bi++] = (byte)(zv >> 8);
            }

            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static void WriteColors(Stream output, byte[] colors)
    {
        var byteCount = colors.Length;
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            var bi = 0;
            byte prevR = 0, prevG = 0, prevB = 0;
            for (var i = 0; i < colors.Length; i += 3)
            {
                var r = colors[i];
                var g = colors[i + 1];
                var b = colors[i + 2];

                buffer[bi++] = ZigZag8(unchecked((sbyte)(r - prevR)));
                buffer[bi++] = ZigZag8(unchecked((sbyte)(g - prevG)));
                buffer[bi++] = ZigZag8(unchecked((sbyte)(b - prevB)));

                prevR = r;
                prevG = g;
                prevB = b;
            }

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
            ushort prev = 0;
            foreach (var index in indices)
            {
                var u = (ushort)index;
                var zz = ZigZag16(unchecked((short)(u - prev)));
                prev = u;
                buffer[bi++] = (byte)(zz & 0xFF);
                buffer[bi++] = (byte)(zz >> 8);
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
            var bi = 0;
            var prev = 0;
            foreach (var index in indices)
            {
                var zz = ZigZag32(index - prev);
                prev = index;
                buffer[bi++] = (byte)(zz & 0xFF);
                buffer[bi++] = (byte)((zz >> 8) & 0xFF);
                buffer[bi++] = (byte)((zz >> 16) & 0xFF);
                buffer[bi++] = (byte)(zz >> 24);
            }

            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <summary>Maps a signed delta to unsigned so small ± values stay small: 0,-1,1,-2 → 0,1,2,3.</summary>
    private static ushort ZigZag16(short delta)
    {
        return unchecked((ushort)((delta << 1) ^ (delta >> 15)));
    }

    private static uint ZigZag32(int delta)
    {
        return unchecked((uint)((delta << 1) ^ (delta >> 31)));
    }

    private static byte ZigZag8(sbyte delta)
    {
        return unchecked((byte)((delta << 1) ^ (delta >> 7)));
    }
}
