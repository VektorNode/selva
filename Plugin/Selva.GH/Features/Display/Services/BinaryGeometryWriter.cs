using System;
using System.Buffers;
using System.IO;
using System.IO.Compression;
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
///     [4]  version          = uint32 (currently 4; v2 added uint16 indices, v3 the delta filter,
///                             v4 the planar byte-split layout)
///     [4]  metadataLen      = uint32 byte length of metadata JSON
///     [N]  metadata         = UTF-8 JSON (materials, groups, sourceComponentId, ...)
///
///     -- geometry block --
///     [4]  flags            = uint32 (bit 0: 0 = int16 quantized, 1 = float32 raw;
///                                     bit 1: 0 = uint32 indices, 1 = uint16 indices;
///                                     bit 2: 1 = delta+zigzag filtered, see below;
///                                     bit 5: 1 = planar byte-split layout, see below)
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
///     Planar byte-split layout (v4, <see cref="FlagPlanarByteSplit" />): every delta+zigzag
///     filtered stream (quantized vertices, indices, quantized UVs — never float32 data, never
///     colors) is stored as byte planes over its element count N instead of interleaved LE values:
///
///     vertices        [X-lo x N][Y-lo x N][Z-lo x N][X-hi x N][Y-hi x N][Z-hi x N]   N = vertexCount
///     uint16 indices  [lo x N][hi x N]                                               N = indexCount
///     uint32 indices  [b0 x N][b1 x N][b2 x N][b3 x N]                               N = indexCount
///     uvs             [U-lo x N][V-lo x N][U-hi x N][V-hi x N]                       N = vertexCount
///
///     Byte lengths and the delta/zigzag semantics are identical to the interleaved v3 layout —
///     only byte order within each block changes, and the flag says which a blob uses. The writer
///     picks per blob by measuring both (see <see cref="ChoosePlanarLayout" />): planar wins
///     25-50% on welded surfaces and CAD part scatters, interleaved wins up to 44% when the batch
///     is mostly byte-identical repeated parts. Colors keep the interleaved layout unconditionally:
///     planar per-channel loses on noisy gradient data (measured +58%), and the chunk is small
///     either way.
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
    public const uint Version = 4;

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

    /// <summary>
    ///     Bit 5: delta-filtered streams use the planar byte-split layout (see class remarks).
    ///     Always set by the v4 writer; exists so decoders handle pre-v4 blobs through the same
    ///     read path.
    /// </summary>
    public const uint FlagPlanarByteSplit = 0x20;

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

        /// <summary>Which byte layout the filtered streams used — see <see cref="FlagPlanarByteSplit" />.</summary>
        public bool UsedPlanarByteSplit;
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

        // Filtered streams get whichever byte layout deflates smaller (see ChoosePlanarLayout).
        // Float32 vertices are never filtered, so the flag is meaningless there — and the index
        // stream alone doesn't justify a probe.
        var usePlanar = !useFloat32
                        && ChoosePlanarLayout(vertices, originX, originY, originZ,
                            scaleX, scaleY, scaleZ);

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

            if (usePlanar)
            {
                flags |= FlagPlanarByteSplit;
            }

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
                WriteFiltered(output, vertexCount * 3 * sizeof(short),
                    buffer => EncodeInt16Vertices(buffer, vertices, usePlanar,
                        originX, originY, originZ, scaleX, scaleY, scaleZ));
            }

            writer.Write((uint)indices.Length);
            WriteFiltered(output, indices.Length * (useUint16Indices ? sizeof(ushort) : sizeof(uint)),
                buffer =>
                {
                    if (useUint16Indices)
                    {
                        EncodeUInt16Indices(buffer, indices, usePlanar);
                    }
                    else
                    {
                        EncodeUInt32Indices(buffer, indices, usePlanar);
                    }
                });

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
                    WriteFiltered(output, uvs.Length * sizeof(ushort),
                        buffer => EncodeUInt16Uvs(buffer, uvs, usePlanar,
                            uvOriginU, uvOriginV, uvScaleU, uvScaleV));
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
            UsedPlanarByteSplit = usePlanar,
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

    /// <summary>Rents a buffer, fills it via <paramref name="encode" />, and writes it out.</summary>
    private static void WriteFiltered(Stream output, int byteCount, Action<byte[]> encode)
    {
        if (byteCount == 0)
        {
            return;
        }

        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            encode(buffer);
            output.Write(buffer, 0, byteCount);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <summary>
    ///     Vertex count below which the layout probe is skipped and planar is assumed. Probing costs
    ///     two trial DEFLATE passes; on a small batch the wire difference is a few hundred bytes and
    ///     not worth them.
    /// </summary>
    private const int MinVerticesForLayoutProbe = 4096;

    /// <summary>
    ///     Picks the byte layout for the filtered streams by trial-deflating both and keeping the
    ///     smaller. Neither layout wins universally:
    ///
    ///     Planar byte-split groups like-valued bytes, so the high planes of small deltas collapse to
    ///     runs of zeros — 25-50% smaller on welded surfaces and CAD part scatters.
    ///
    ///     Interleaved keeps each mesh's bytes contiguous, so DEFLATE's LZ77 window matches a whole
    ///     repeated part as one long run. Definitions that array or instance one part (a screw placed
    ///     500 times) compress up to 44% better interleaved, because planar scatters each copy's
    ///     bytes across six distant planes and breaks those matches. The crossover sits around 75-80%
    ///     byte-identical repeats — too close to call from a cheap heuristic, hence the measurement.
    ///
    ///     The probe deflates the vertex stream only (the dominant block, and the one whose layout
    ///     drives the index stream's fate) at <see cref="CompressionLevel.Fastest" />, which ranks the
    ///     two layouts the same way Optimal does at a fraction of the cost. Encoding runs on the
    ///     component's background task, so this never blocks the solver thread.
    /// </summary>
    private static bool ChoosePlanarLayout(
        float[] vertices,
        double originX, double originY, double originZ,
        double scaleX, double scaleY, double scaleZ)
    {
        var vertexCount = vertices.Length / 3;
        if (vertexCount < MinVerticesForLayoutProbe)
        {
            return true;
        }

        var byteCount = vertexCount * 3 * sizeof(short);
        var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
        try
        {
            EncodeInt16Vertices(buffer, vertices, true,
                originX, originY, originZ, scaleX, scaleY, scaleZ);
            var planarBytes = DeflatedLength(buffer, byteCount);

            EncodeInt16Vertices(buffer, vertices, false,
                originX, originY, originZ, scaleX, scaleY, scaleZ);
            var interleavedBytes = DeflatedLength(buffer, byteCount);

            return planarBytes <= interleavedBytes;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <summary>Deflated size of a buffer prefix, measured without keeping the compressed bytes.</summary>
    private static long DeflatedLength(byte[] buffer, int length)
    {
        using (var counter = new CountingStream())
        {
            using (var deflate = new DeflateStream(counter, CompressionLevel.Fastest, leaveOpen: true))
            {
                deflate.Write(buffer, 0, length);
            }

            return counter.Length;
        }
    }

    /// <summary>Write-only sink that counts bytes instead of storing them.</summary>
    private sealed class CountingStream : Stream
    {
        private long _length;

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => _length;

        public override long Position
        {
            get => _length;
            set => throw new NotSupportedException();
        }

        public override void Write(byte[] buffer, int offset, int count) => _length += count;
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
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

    /// <summary>
    ///     Encodes quantized, delta+zigzag filtered vertices into <paramref name="buffer" />, in the
    ///     planar byte-split layout when <paramref name="planar" /> is set, otherwise interleaved.
    /// </summary>
    private static void EncodeInt16Vertices(
        byte[] buffer, float[] vertices, bool planar,
        double originX, double originY, double originZ,
        double scaleX, double scaleY, double scaleZ)
    {
        var vertexCount = vertices.Length / 3;
        short prevX = 0, prevY = 0, prevZ = 0;
        for (int i = 0, v = 0; i < vertices.Length; i += 3, v++)
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

            if (planar)
            {
                buffer[v] = (byte)(zx & 0xFF);
                buffer[vertexCount + v] = (byte)(zy & 0xFF);
                buffer[vertexCount * 2 + v] = (byte)(zz & 0xFF);
                buffer[vertexCount * 3 + v] = (byte)(zx >> 8);
                buffer[vertexCount * 4 + v] = (byte)(zy >> 8);
                buffer[vertexCount * 5 + v] = (byte)(zz >> 8);
            }
            else
            {
                var bi = v * 6;
                buffer[bi] = (byte)(zx & 0xFF);
                buffer[bi + 1] = (byte)(zx >> 8);
                buffer[bi + 2] = (byte)(zy & 0xFF);
                buffer[bi + 3] = (byte)(zy >> 8);
                buffer[bi + 4] = (byte)(zz & 0xFF);
                buffer[bi + 5] = (byte)(zz >> 8);
            }
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

    private static void EncodeUInt16Uvs(
        byte[] buffer, float[] uvs, bool planar,
        double originU, double originV,
        double scaleU, double scaleV)
    {
        var count = uvs.Length / 2;
        ushort prevU = 0, prevV = 0;
        for (int i = 0, v = 0; i < uvs.Length; i += 2, v++)
        {
            // Unsigned quantization: q in [0, 65535], uv = origin + q * scale. Clamp guards
            // rounding at the extent boundary.
            var qu = (ushort)Math.Min(Math.Max(Math.Round((uvs[i] - originU) / scaleU), 0.0), 65535.0);
            var qv = (ushort)Math.Min(Math.Max(Math.Round((uvs[i + 1] - originV) / scaleV), 0.0), 65535.0);

            var zu = ZigZag16(unchecked((short)(qu - prevU)));
            var zv = ZigZag16(unchecked((short)(qv - prevV)));
            prevU = qu;
            prevV = qv;

            if (planar)
            {
                buffer[v] = (byte)(zu & 0xFF);
                buffer[count + v] = (byte)(zv & 0xFF);
                buffer[count * 2 + v] = (byte)(zu >> 8);
                buffer[count * 3 + v] = (byte)(zv >> 8);
            }
            else
            {
                var bi = v * 4;
                buffer[bi] = (byte)(zu & 0xFF);
                buffer[bi + 1] = (byte)(zu >> 8);
                buffer[bi + 2] = (byte)(zv & 0xFF);
                buffer[bi + 3] = (byte)(zv >> 8);
            }
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

    private static void EncodeUInt16Indices(byte[] buffer, int[] indices, bool planar)
    {
        var count = indices.Length;
        ushort prev = 0;
        for (var i = 0; i < count; i++)
        {
            var u = (ushort)indices[i];
            var zz = ZigZag16(unchecked((short)(u - prev)));
            prev = u;

            if (planar)
            {
                buffer[i] = (byte)(zz & 0xFF);
                buffer[count + i] = (byte)(zz >> 8);
            }
            else
            {
                buffer[i * 2] = (byte)(zz & 0xFF);
                buffer[i * 2 + 1] = (byte)(zz >> 8);
            }
        }
    }

    private static void EncodeUInt32Indices(byte[] buffer, int[] indices, bool planar)
    {
        var count = indices.Length;
        var prev = 0;
        for (var i = 0; i < count; i++)
        {
            var zz = ZigZag32(indices[i] - prev);
            prev = indices[i];

            if (planar)
            {
                buffer[i] = (byte)(zz & 0xFF);
                buffer[count + i] = (byte)((zz >> 8) & 0xFF);
                buffer[count * 2 + i] = (byte)((zz >> 16) & 0xFF);
                buffer[count * 3 + i] = (byte)(zz >> 24);
            }
            else
            {
                buffer[i * 4] = (byte)(zz & 0xFF);
                buffer[i * 4 + 1] = (byte)((zz >> 8) & 0xFF);
                buffer[i * 4 + 2] = (byte)((zz >> 16) & 0xFF);
                buffer[i * 4 + 3] = (byte)(zz >> 24);
            }
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
