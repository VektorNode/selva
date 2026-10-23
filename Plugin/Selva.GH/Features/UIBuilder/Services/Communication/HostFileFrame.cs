#nullable enable
using System;
using System.Text;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     A file and its envelope in one binary WebSocket frame, used both ways between the Rhino panel
///     and the plugin:
///     <code>
///     offset  size      field
///     0       4         magic "SLHF" (ASCII)
///     4       4         header length N, uint32 little-endian
///     8       N         header: UTF-8 JSON, an ordinary envelope with type and sessionId
///     8+N     the rest  the file's bytes
///     </code>
///     Each frame names itself because the page hands every other binary frame to the mesh
///     collector, and a reply to one socket can land between an outputs envelope and its mesh
///     frames. Pinned by packages/schemas/fixtures/wire/host-picked-file.slhf, which the page's
///     codec reads too.
/// </summary>
internal static class HostFileFrame
{
    private const int PrefixLength = 8;
    private static readonly byte[] Magic = { (byte)'S', (byte)'L', (byte)'H', (byte)'F' };

    public static byte[] Encode(string headerJson, byte[] body)
    {
        var header = Encoding.UTF8.GetBytes(headerJson);
        var frame = new byte[PrefixLength + header.Length + body.Length];
        Buffer.BlockCopy(Magic, 0, frame, 0, Magic.Length);
        WriteUInt32LittleEndian(frame, 4, (uint)header.Length);
        Buffer.BlockCopy(header, 0, frame, PrefixLength, header.Length);
        Buffer.BlockCopy(body, 0, frame, PrefixLength + header.Length, body.Length);
        return frame;
    }

    /// <summary>False for anything that isn't a whole SLHF frame with a non-empty header.</summary>
    public static bool TryDecode(byte[] frame, out string headerJson, out ArraySegment<byte> body)
    {
        headerJson = "";
        body = default;

        if (frame.Length < PrefixLength ||
            frame[0] != Magic[0] || frame[1] != Magic[1] || frame[2] != Magic[2] || frame[3] != Magic[3])
        {
            return false;
        }

        var headerLength = (long)ReadUInt32LittleEndian(frame, 4);
        if (headerLength == 0 || headerLength > frame.Length - PrefixLength)
        {
            return false;
        }

        headerJson = Encoding.UTF8.GetString(frame, PrefixLength, (int)headerLength);
        var bodyOffset = PrefixLength + (int)headerLength;
        body = new ArraySegment<byte>(frame, bodyOffset, frame.Length - bodyOffset);
        return true;
    }

    // BinaryPrimitives isn't in net48.
    private static void WriteUInt32LittleEndian(byte[] buffer, int offset, uint value)
    {
        buffer[offset] = (byte)value;
        buffer[offset + 1] = (byte)(value >> 8);
        buffer[offset + 2] = (byte)(value >> 16);
        buffer[offset + 3] = (byte)(value >> 24);
    }

    private static uint ReadUInt32LittleEndian(byte[] buffer, int offset)
    {
        return buffer[offset] |
               ((uint)buffer[offset + 1] << 8) |
               ((uint)buffer[offset + 2] << 16) |
               ((uint)buffer[offset + 3] << 24);
    }
}
