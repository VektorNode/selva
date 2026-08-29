using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Selva.Slva;

namespace Selva.Tests;

public class BlobCompressorTests
{
    private const uint CompressedMagic = 0x5A564C53; // "SLVZ"

    [Fact]
    public void Compress_LeavesSmallBlobsUntouched()
    {
        var blob = new byte[100];
        new Random(1).NextBytes(blob);

        var result = BlobCompressor.Compress(blob);

        Assert.Same(blob, result);
    }

    [Fact]
    public void Compress_WrapsCompressibleBlobWithMagicAndRoundtrips()
    {
        // 64 KB repeating pattern, mirroring the byte coherency of quantized geometry.
        var blob = new byte[64 * 1024];
        for (var i = 0; i < blob.Length; i++)
        {
            blob[i] = (byte)(i % 16);
        }

        var result = BlobCompressor.Compress(blob);

        Assert.True(result.Length < blob.Length);
        Assert.Equal(CompressedMagic, BitConverter.ToUInt32(result, 0));
        Assert.Equal((uint)blob.Length, BitConverter.ToUInt32(result, 4));

        var roundtripped = Inflate(result);
        Assert.Equal(blob, roundtripped);
    }

    [Fact]
    public void Compress_ReturnsOriginalWhenCompressionDoesNotHelp()
    {
        // Random data above the threshold: deflate can't beat it, so the uncompressed bytes come
        // back (no SLVZ magic).
        var blob = new byte[64 * 1024];
        new Random(42).NextBytes(blob);

        var result = BlobCompressor.Compress(blob);

        Assert.Same(blob, result);
    }

    private static byte[] Inflate(byte[] container)
    {
        var uncompressedLen = (int)BitConverter.ToUInt32(container, 4);
        using var input = new MemoryStream(container, 8, container.Length - 8);
        using var deflate = new DeflateStream(input, CompressionMode.Decompress);
        var output = new byte[uncompressedLen];
        var read = 0;
        while (read < uncompressedLen)
        {
            var n = deflate.Read(output, read, uncompressedLen - read);
            if (n == 0)
            {
                break;
            }

            read += n;
        }

        return output.Take(read).ToArray();
    }
}
