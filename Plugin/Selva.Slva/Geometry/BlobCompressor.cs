using System;
using System.IO;
using System.IO.Compression;

namespace Selva.Slva;

/// <summary>
///     Optional raw-DEFLATE wrapper around a SLVA mesh blob. The WebDisplay payload otherwise ships
///     uncompressed (the SvelteKit adapter only pre-compresses static assets, and the local-mode
///     WebSocket has no permessage-deflate), so for cloud delivery the quantized-int16 geometry
///     benefits from a generic entropy pass before base64.
///
///     Wire format of the compressed container (little-endian):
///
///     [4]  magic            = "SLVZ" (0x53 0x4C 0x56 0x5A) — distinct from the inner "SLVA" so the
///                             decoder can sniff which it has from the first four bytes
///     [4]  uncompressedLen  = uint32 byte length of the original SLVA blob (decode-buffer hint)
///     [N]  payload          = raw DEFLATE stream of the original SLVA blob
///
///     Compression is applied only when it actually shrinks the blob past a threshold (see
///     <see cref="Compress" />); otherwise the original SLVA bytes are returned unchanged. The
///     decoder distinguishes the two cases by the leading magic, so a caller can always feed the
///     result straight back to the parser.
/// </summary>
public static class BlobCompressor
{
    public const uint CompressedMagic = 0x5A564C53; // "SLVZ" little-endian

    /// <summary>
    ///     Don't bother compressing blobs below this size — the container overhead and round-trip CPU
    ///     aren't worth it, and tiny payloads barely move the wire.
    /// </summary>
    private const int MinCompressBytes = 4 * 1024;

    /// <summary>
    ///     Returns the SLVZ-wrapped blob when compression helps, otherwise the original bytes.
    ///     The result is self-describing: callers don't track whether it was compressed — the
    ///     decoder reads the leading magic.
    /// </summary>
    /// <summary>
    ///     If the blob is an SLVZ container, inflate it back to the raw bytes; otherwise return the
    ///     input unchanged. Mirrors the web decoder's detection by leading magic.
    /// </summary>
    public static byte[] MaybeDecompress(byte[] blob)
    {
        if (blob == null || blob.Length < 8 || BitConverter.ToUInt32(blob, 0) != CompressedMagic)
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

    public static byte[] Compress(byte[] slvaBlob)
    {
        if (slvaBlob == null)
        {
            throw new ArgumentNullException(nameof(slvaBlob));
        }

        return Compress(slvaBlob, slvaBlob.Length);
    }

    /// <summary>
    ///     Same, but reads only the first <paramref name="length" /> bytes of
    ///     <paramref name="buffer" />. Lets callers hand over a MemoryStream's internal buffer
    ///     (<see cref="MemoryStream.GetBuffer" />) without a full-payload ToArray copy first. When
    ///     compression doesn't win and the buffer is oversized, the result is a right-sized copy.
    /// </summary>
    public static byte[] Compress(byte[] buffer, int length)
    {
        if (buffer == null)
        {
            throw new ArgumentNullException(nameof(buffer));
        }

        if (length < 0 || length > buffer.Length)
        {
            throw new ArgumentOutOfRangeException(nameof(length));
        }

        if (length < MinCompressBytes)
        {
            return Trimmed(buffer, length);
        }

        // Write the 8-byte container header up front, then deflate straight into the same stream —
        // both header fields are known before compressing, so building the compressed body in a
        // separate stream and copying it behind a header (the previous shape) paid a full extra
        // copy of the compressed payload for nothing.
        using (var ms = new MemoryStream())
        using (var writer = new BinaryWriter(ms))
        {
            writer.Write(CompressedMagic);
            writer.Write((uint)length);

            // Optimal, measured against the alternatives on delta-filtered mesh payloads (2.7 MB
            // welded grid): Fastest is ~7x quicker (4 ms vs 30 ms) but 36% larger on the wire;
            // SmallestSize doubles the time for <1% size. Encoding runs inside the component's
            // background task, so Optimal's CPU cost doesn't block the solver thread.
            using (var deflate = new DeflateStream(ms, CompressionLevel.Optimal, leaveOpen: true))
            {
                deflate.Write(buffer, 0, length);
            }

            // Header + body must be an actual net win, else ship the original bytes.
            if (ms.Length >= length)
            {
                return Trimmed(buffer, length);
            }

            return ms.ToArray();
        }
    }

    private static byte[] Trimmed(byte[] buffer, int length)
    {
        if (buffer.Length == length)
        {
            return buffer;
        }

        var copy = new byte[length];
        Buffer.BlockCopy(buffer, 0, copy, 0, length);
        return copy;
    }
}
