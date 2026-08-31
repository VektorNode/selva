using System;
using System.Collections.Generic;
using System.IO;

namespace Selva.Slva;

/// <summary>
///     The SLVM chunk stream: header (magic, version, chunkCount), then per chunk
///     [fourcc][byteLen][payload][pad-to-4]. Byte layout in <see cref="SlvmDocument" />'s spec.
/// </summary>
internal static class SlvmChunks
{
    public static byte[] Write(List<(uint type, byte[] payload)> chunks)
    {
        using (var ms = new MemoryStream())
        using (var w = new BinaryWriter(ms))
        {
            w.Write(SlvmDocument.Magic);
            w.Write(SlvmDocument.Version);
            w.Write((uint)chunks.Count);
            foreach (var (type, payload) in chunks)
            {
                var body = payload ?? Array.Empty<byte>();
                w.Write(type);
                w.Write((uint)body.Length);
                w.Write(body);
                for (var pad = (4 - body.Length % 4) % 4; pad > 0; pad--)
                {
                    w.Write((byte)0);
                }
            }

            return ms.ToArray();
        }
    }

    public static List<(uint type, byte[] payload)> Read(byte[] bytes)
    {
        if (bytes == null || bytes.Length < 12 || BitConverter.ToUInt32(bytes, 0) != SlvmDocument.Magic)
        {
            throw new InvalidDataException("Not an SLVM container (bad magic).");
        }

        var version = BitConverter.ToUInt32(bytes, 4);
        if (version != SlvmDocument.Version)
        {
            throw new InvalidDataException($"Unsupported SLVM version {version} (expected {SlvmDocument.Version}).");
        }

        var count = BitConverter.ToUInt32(bytes, 8);
        var chunks = new List<(uint, byte[])>((int)count);
        var offset = 12;
        for (var i = 0; i < count; i++)
        {
            if (offset + 8 > bytes.Length)
            {
                throw new InvalidDataException("Truncated SLVM chunk header.");
            }

            var type = BitConverter.ToUInt32(bytes, offset);
            var len = (int)BitConverter.ToUInt32(bytes, offset + 4);
            offset += 8;
            if (offset + len > bytes.Length)
            {
                throw new InvalidDataException("Truncated SLVM chunk payload.");
            }

            var payload = new byte[len];
            Buffer.BlockCopy(bytes, offset, payload, 0, len);
            chunks.Add((type, payload));
            offset += len + (4 - len % 4) % 4;
        }

        return chunks;
    }
}
