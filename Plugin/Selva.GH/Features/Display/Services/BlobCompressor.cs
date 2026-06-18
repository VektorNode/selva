using System;
using System.IO;
using System.IO.Compression;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Optional gzip wrapper around a SLVA mesh blob. The WebDisplay payload otherwise ships
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
    ///     Returns the gzip-wrapped blob when compression helps, otherwise the original bytes.
    ///     The result is self-describing: callers don't track whether it was compressed — the
    ///     decoder reads the leading magic.
    /// </summary>
    public static byte[] Compress(byte[] slvaBlob)
    {
        if (slvaBlob == null)
        {
            throw new ArgumentNullException(nameof(slvaBlob));
        }

        if (slvaBlob.Length < MinCompressBytes)
        {
            return slvaBlob;
        }

        byte[] deflated;
        using (var ms = new MemoryStream())
        {
            using (var deflate = new DeflateStream(ms, CompressionLevel.Optimal, leaveOpen: true))
            {
                deflate.Write(slvaBlob, 0, slvaBlob.Length);
            }

            deflated = ms.ToArray();
        }

        // Container overhead is 8 bytes; only keep the compressed form if it's an actual net win.
        if (deflated.Length + 8 >= slvaBlob.Length)
        {
            return slvaBlob;
        }

        using (var ms = new MemoryStream(deflated.Length + 8))
        using (var writer = new BinaryWriter(ms))
        {
            writer.Write(CompressedMagic);
            writer.Write((uint)slvaBlob.Length);
            writer.Write(deflated);
            return ms.ToArray();
        }
    }
}
