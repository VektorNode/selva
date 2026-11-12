#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Selva.AppFormat;

// ============================================================================
// Selva app file (.slvx)
// ============================================================================
//
// One Grasshopper definition packaged to open in the Selva app. Little-endian.
//
//   offset 0   4 bytes   magic "SLVX"
//   offset 4   u8        format version (1)
//   offset 5   u8        flags; bit 0 (0x1) = the definition is encrypted
//   offset 6   chunks, back to back, until the end of the file
//
//   chunk      4 bytes   ASCII tag
//              u32       payload length in bytes
//              payload
//
//   "NAME"     UTF-8 app name, shown as the window title.
//   "ICON"     PNG bytes for the window icon. Optional.
//   "KDF "     Only when encrypted, and before "DEFN":
//                u32       PBKDF2-HMAC-SHA256 iterations
//                16 bytes  salt for the file key
//                8 bytes   key id (AppFileKey.IdOf), so a machine can tell which stored key fits
//   "DEFN"     Always last:
//                u8        definition kind: 0 = Grasshopper binary archive (.gh), 1 = XML (.ghx)
//                plain:     the definition's bytes
//                encrypted: 12-byte nonce, ciphertext, 16-byte tag (AES-256-GCM). The
//                           associated data is every byte of the file before the nonce, so a
//                           changed name, icon or KDF chunk fails authentication.
//
// A reader skips tags it doesn't know. The magic is frozen; a change readers can't skip bumps
// the version.

/// <summary>What a Selva app file says about itself without its key.</summary>
internal sealed class AppFileInfo
{
    public string Name { get; set; } = "";

    public byte[]? IconPng { get; set; }

    public bool Encrypted { get; set; }

    /// <summary>Hex of the key id; empty unless <see cref="Encrypted" />.</summary>
    public string KeyId { get; set; } = "";

    public int Iterations { get; set; }

    public byte[] Salt { get; set; } = Array.Empty<byte>();

    public AppDefinitionKind Kind { get; set; }

    /// <summary>The definition's bytes when plain; nonce, ciphertext and tag when encrypted.</summary>
    public byte[] Body { get; set; } = Array.Empty<byte>();

    /// <summary>Every byte before <see cref="Body" />: what an encrypted body is authenticated against.</summary>
    public byte[] Preamble { get; set; } = Array.Empty<byte>();
}

internal enum AppDefinitionKind : byte
{
    Binary = 0,
    Xml = 1
}

/// <summary>Reads and writes the container. The cipher is <c>AppFileCipher</c>.</summary>
internal static class AppFile
{
    public const string Extension = ".slvx";
    public const byte Version = 1;
    public const byte EncryptedFlag = 0x1;

    /// <summary>What an exporter accepts for the icon: a 256 px PNG fits several times over.</summary>
    public const int MaxIconBytes = 256 * 1024;

    public const int SaltLength = 16;
    public const int KeyIdLength = 8;

    private const int HeaderLength = 6;
    private const int MaxNameBytes = 512;

    private static readonly byte[] Magic = { (byte)'S', (byte)'L', (byte)'V', (byte)'X' };

    /// <summary>The eight bytes every PNG starts with: an icon is nothing else.</summary>
    public static bool IsPng(byte[] bytes)
    {
        byte[] signature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        if (bytes.Length < signature.Length)
        {
            return false;
        }

        for (var i = 0; i < signature.Length; i++)
        {
            if (bytes[i] != signature[i])
            {
                return false;
            }
        }

        return true;
    }

    public static bool HasMagic(byte[] bytes)
    {
        if (bytes.Length < Magic.Length)
        {
            return false;
        }

        for (var i = 0; i < Magic.Length; i++)
        {
            if (bytes[i] != Magic[i])
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Reads the first bytes of a file only: enough to tell an app file from a definition.</summary>
    public static bool HasMagic(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var head = new byte[Magic.Length];
            return stream.Read(head, 0, head.Length) == head.Length && HasMagic(head);
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <returns>Null when <paramref name="bytes" /> is a readable app file; otherwise why not, for the user.</returns>
    public static string? TryRead(byte[] bytes, out AppFileInfo info)
    {
        info = new AppFileInfo();
        if (!HasMagic(bytes) || bytes.Length < HeaderLength)
        {
            return "This isn't a Selva app file.";
        }

        if (bytes[4] != Version)
        {
            return "This app was made with a newer Selva. Update Selva to open it.";
        }

        info.Encrypted = (bytes[5] & EncryptedFlag) != 0;
        var hasKdf = false;
        var offset = HeaderLength;
        while (offset < bytes.Length)
        {
            if (bytes.Length - offset < 8)
            {
                return Damaged;
            }

            var tag = Encoding.ASCII.GetString(bytes, offset, 4);
            var length = BitConverter.ToUInt32(bytes, offset + 4);
            var start = offset + 8;
            if (length > (uint)(bytes.Length - start))
            {
                return Damaged;
            }

            var end = start + (int)length;
            switch (tag)
            {
                case "NAME":
                    info.Name = Encoding.UTF8.GetString(bytes, start, (int)length);
                    break;

                case "ICON":
                    info.IconPng = Slice(bytes, start, end);
                    break;

                case "KDF ":
                    if (length != 4 + SaltLength + KeyIdLength)
                    {
                        return Damaged;
                    }

                    info.Iterations = (int)BitConverter.ToUInt32(bytes, start);
                    info.Salt = Slice(bytes, start + 4, start + 4 + SaltLength);
                    info.KeyId = AppFileKey.Hex(Slice(bytes, start + 4 + SaltLength, end));
                    hasKdf = true;
                    break;

                case "DEFN":
                    if (length < 1 || end != bytes.Length || bytes[start] > (byte)AppDefinitionKind.Xml)
                    {
                        return Damaged;
                    }

                    if (info.Encrypted && (!hasKdf || info.Iterations <= 0))
                    {
                        return Damaged;
                    }

                    info.Kind = (AppDefinitionKind)bytes[start];
                    info.Preamble = Slice(bytes, 0, start + 1);
                    info.Body = Slice(bytes, start + 1, end);
                    return null;
            }

            offset = end;
        }

        return Damaged;
    }

    /// <summary>Everything up to the definition's body: <see cref="AppFileInfo.Preamble" /> for a new file.</summary>
    /// <param name="bodyLength">The body's length as it will be stored, so the chunk length is final.</param>
    public static byte[] BuildPreamble(string name, byte[]? iconPng, AppDefinitionKind kind, int bodyLength,
        AppFileKdf? kdf)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        if (nameBytes.Length == 0 || nameBytes.Length > MaxNameBytes)
        {
            throw new ArgumentException("The app needs a name of at most 512 bytes.", nameof(name));
        }

        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);
        writer.Write(Magic);
        writer.Write(Version);
        writer.Write(kdf != null ? EncryptedFlag : (byte)0);
        WriteChunk(writer, "NAME", nameBytes);
        if (iconPng != null && iconPng.Length > 0)
        {
            WriteChunk(writer, "ICON", iconPng);
        }

        if (kdf != null)
        {
            var payload = new List<byte>(4 + SaltLength + KeyIdLength);
            payload.AddRange(BitConverter.GetBytes((uint)kdf.Iterations));
            payload.AddRange(kdf.Salt);
            payload.AddRange(kdf.KeyId);
            WriteChunk(writer, "KDF ", payload.ToArray());
        }

        writer.Write(Encoding.ASCII.GetBytes("DEFN"));
        writer.Write((uint)(1 + bodyLength));
        writer.Write((byte)kind);
        writer.Flush();
        return stream.ToArray();
    }

    public static byte[] Concat(byte[] preamble, byte[] body)
    {
        var file = new byte[preamble.Length + body.Length];
        Buffer.BlockCopy(preamble, 0, file, 0, preamble.Length);
        Buffer.BlockCopy(body, 0, file, preamble.Length, body.Length);
        return file;
    }

    private const string Damaged = "This Selva app file is damaged. Ask for a new copy.";

    private static void WriteChunk(BinaryWriter writer, string tag, byte[] payload)
    {
        writer.Write(Encoding.ASCII.GetBytes(tag));
        writer.Write((uint)payload.Length);
        writer.Write(payload);
    }

    private static byte[] Slice(byte[] bytes, int start, int end)
    {
        var slice = new byte[end - start];
        Buffer.BlockCopy(bytes, start, slice, 0, slice.Length);
        return slice;
    }
}

/// <summary>The "KDF " chunk of an encrypted app file.</summary>
internal sealed class AppFileKdf
{
    public AppFileKdf(int iterations, byte[] salt, byte[] keyId)
    {
        Iterations = iterations;
        Salt = salt;
        KeyId = keyId;
    }

    public int Iterations { get; }

    public byte[] Salt { get; }

    public byte[] KeyId { get; }
}
