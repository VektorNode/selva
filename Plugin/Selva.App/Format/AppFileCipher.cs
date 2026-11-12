#nullable enable
using System;
using System.Security.Cryptography;

namespace Selva.AppFormat;

/// <summary>
///     Packs and unpacks a definition, encrypting it when a key is given. Compiled into the
///     plug-in only: AES-GCM doesn't exist on .NET Framework, and the app never needs the
///     definition's bytes.
/// </summary>
internal static class AppFileCipher
{
    private const int NonceLength = 12;
    private const int TagLength = 16;

    /// <param name="key">Null or empty writes the definition unencrypted.</param>
    public static byte[] Pack(string name, byte[]? iconPng, AppDefinitionKind kind, byte[] definition, string? key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return AppFile.Concat(AppFile.BuildPreamble(name, iconPng, kind, definition.Length, null), definition);
        }

        var salt = RandomNumberGenerator.GetBytes(AppFile.SaltLength);
        var kdf = new AppFileKdf(AppFileKey.Iterations, salt, AppFileKey.IdOf(key));
        var bodyLength = NonceLength + definition.Length + TagLength;
        var preamble = AppFile.BuildPreamble(name, iconPng, kind, bodyLength, kdf);

        var nonce = RandomNumberGenerator.GetBytes(NonceLength);
        var cipherText = new byte[definition.Length];
        var tag = new byte[TagLength];
        using (var aes = new AesGcm(AppFileKey.FileKey(key, salt, kdf.Iterations), TagLength))
        {
            aes.Encrypt(nonce, definition, cipherText, tag, preamble);
        }

        var body = new byte[bodyLength];
        Buffer.BlockCopy(nonce, 0, body, 0, NonceLength);
        Buffer.BlockCopy(cipherText, 0, body, NonceLength, cipherText.Length);
        Buffer.BlockCopy(tag, 0, body, NonceLength + cipherText.Length, TagLength);
        return AppFile.Concat(preamble, body);
    }

    /// <returns>Null when <paramref name="definition" /> holds the definition; otherwise why not, for the user.</returns>
    public static string? TryUnpack(AppFileInfo info, string? key, out byte[] definition)
    {
        definition = Array.Empty<byte>();
        if (!info.Encrypted)
        {
            definition = info.Body;
            return null;
        }

        if (string.IsNullOrEmpty(key))
        {
            return "This app is protected. It needs its key to open.";
        }

        if (info.Body.Length < NonceLength + TagLength)
        {
            return "This Selva app file is damaged. Ask for a new copy.";
        }

        var nonce = info.Body.AsSpan(0, NonceLength);
        var cipherText = info.Body.AsSpan(NonceLength, info.Body.Length - NonceLength - TagLength);
        var tag = info.Body.AsSpan(info.Body.Length - TagLength);
        var plain = new byte[cipherText.Length];
        try
        {
            using var aes = new AesGcm(AppFileKey.FileKey(key!, info.Salt, info.Iterations), TagLength);
            aes.Decrypt(nonce, cipherText, tag, plain, info.Preamble);
        }
        catch (CryptographicException)
        {
            // A wrong key and a changed file fail the same way.
            return "That key doesn't open this app, or the file was changed.";
        }

        definition = plain;
        return null;
    }
}
