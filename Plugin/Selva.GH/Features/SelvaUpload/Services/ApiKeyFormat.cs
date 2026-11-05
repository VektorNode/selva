#nullable enable
using System.Text;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     The shape of a Selva API key: <c>selva_</c>, 30 base62 characters, and 6 base62 characters
///     of CRC32 over those 30. The checksum catches a typo or a truncated paste before anything is
///     sent; it isn't a MAC.
/// </summary>
public static class ApiKeyFormat
{
    public const string Prefix = "selva_";

    private const int RandomLength = 30;
    private const int ChecksumLength = 6;
    private const string Base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    public static bool IsWellFormed(string? key)
    {
        if (key == null || key.Length != Prefix.Length + RandomLength + ChecksumLength ||
            !key.StartsWith(Prefix, System.StringComparison.Ordinal))
        {
            return false;
        }

        for (var i = Prefix.Length; i < key.Length; i++)
        {
            if (Base62.IndexOf(key[i]) < 0)
            {
                return false;
            }
        }

        var random = key.Substring(Prefix.Length, RandomLength);
        return key.Substring(Prefix.Length + RandomLength) == Checksum(random);
    }

    private static string Checksum(string random)
    {
        var n = Crc32(Encoding.ASCII.GetBytes(random));
        var chars = new char[ChecksumLength];
        for (var i = ChecksumLength - 1; i >= 0; i--)
        {
            chars[i] = Base62[(int)(n % 62)];
            n /= 62;
        }

        return new string(chars);
    }

    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
            {
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
            }
        }

        return ~crc;
    }
}
