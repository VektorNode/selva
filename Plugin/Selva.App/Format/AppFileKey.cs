#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace Selva.AppFormat;

/// <summary>
///     Turns the key an author typed into the file key and the key id. Both are slow on purpose:
///     the key is a passphrase a person chose, and an app file can be attacked offline.
/// </summary>
internal static class AppFileKey
{
    /// <summary>What new files are written with; a reader uses the count stored in the file.</summary>
    public const int Iterations = 210_000;

    public const int FileKeyLength = 32;

    // Fixed, unlike the file key's salt: the id has to come out the same on every machine and for
    // every file, or a stored key could never be matched to the file that needs it.
    private static readonly byte[] IdSalt = Encoding.ASCII.GetBytes("selva-app-key-id/1");

    /// <summary>
    ///     Names a key without revealing it. Identical for every file protected with the same key,
    ///     so a machine that stored the key once opens all of them without asking.
    /// </summary>
    public static byte[] IdOf(string key)
    {
        return Derive(key, IdSalt, Iterations, AppFile.KeyIdLength);
    }

    public static byte[] FileKey(string key, byte[] salt, int iterations)
    {
        return Derive(key, salt, iterations, FileKeyLength);
    }

    public static string Hex(byte[] bytes)
    {
        var text = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes)
        {
            text.Append(b.ToString("x2"));
        }

        return text.ToString();
    }

    private static byte[] Derive(string key, byte[] salt, int iterations, int length)
    {
        var password = Encoding.UTF8.GetBytes(key);
#if NET
        return Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, length);
#else
        using var kdf = new Rfc2898DeriveBytes(password, salt, iterations, HashAlgorithmName.SHA256);
        return kdf.GetBytes(length);
#endif
    }
}
