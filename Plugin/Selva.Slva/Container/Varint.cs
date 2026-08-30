using System.IO;

namespace Selva.Slva;

/// <summary>Unsigned LEB128, the integer encoding used throughout the SLVM container.</summary>
internal static class Varint
{
    public static void Write(Stream s, uint value)
    {
        while (value >= 0x80)
        {
            s.WriteByte((byte)(value | 0x80));
            value >>= 7;
        }

        s.WriteByte((byte)value);
    }

    public static uint Read(byte[] bytes, ref int pos)
    {
        uint value = 0;
        var shift = 0;
        while (true)
        {
            if (pos >= bytes.Length || shift > 28)
            {
                throw new InvalidDataException("Malformed varint in SLVM table.");
            }

            var b = bytes[pos++];
            value |= (uint)(b & 0x7F) << shift;
            if ((b & 0x80) == 0)
            {
                return value;
            }

            shift += 7;
        }
    }
}
