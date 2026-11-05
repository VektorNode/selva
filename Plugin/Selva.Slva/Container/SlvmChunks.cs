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
        // Sized up front and written once: the geometry chunk runs to megabytes, and a growing
        // buffer would copy it on every resize and again to trim.
        var size = 12L;
        foreach (var (_, payload) in chunks)
        {
            size += 8 + Padded(payload?.Length ?? 0);
        }

        var bytes = new byte[size];
        var offset = 0;
        WriteUInt32(bytes, ref offset, SlvmDocument.Magic);
        WriteUInt32(bytes, ref offset, SlvmDocument.Version);
        WriteUInt32(bytes, ref offset, (uint)chunks.Count);
        foreach (var (type, payload) in chunks)
        {
            var body = payload ?? Array.Empty<byte>();
            WriteUInt32(bytes, ref offset, type);
            WriteUInt32(bytes, ref offset, (uint)body.Length);
            Buffer.BlockCopy(body, 0, bytes, offset, body.Length);
            offset += Padded(body.Length); // the array is zeroed, so the pad is already there
        }

        return bytes;
    }

    private static int Padded(int length) => length + (4 - length % 4) % 4;

    private static void WriteUInt32(byte[] bytes, ref int offset, uint value)
    {
        bytes[offset] = (byte)value;
        bytes[offset + 1] = (byte)(value >> 8);
        bytes[offset + 2] = (byte)(value >> 16);
        bytes[offset + 3] = (byte)(value >> 24);
        offset += 4;
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
