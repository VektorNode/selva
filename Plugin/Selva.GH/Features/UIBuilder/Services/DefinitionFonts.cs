#nullable enable
using System;
using System.Linq;
using System.Security.Cryptography;
using GH_IO.Serialization;
using GH_IO.Types;
using Grasshopper.Kernel.Special;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Takes the fonts out of a definition before Grasshopper reads it. A scribble or a panel
///     whose font this machine lacks asks for a substitute in a modal dialog, which nobody can
///     answer under the Selva app. That is the usual case for a definition drawn on Windows and
///     opened on a Mac. Without its font each keeps Grasshopper's default, and under the app the
///     canvas is never shown and the document never saved.
/// </summary>
internal static class DefinitionFonts
{
    /// <param name="document">A document's chunk: an archive's "Definition", or a cluster's own.</param>
    /// <returns>True when a font was removed.</returns>
    public static bool Drop(GH_Chunk document)
    {
        if (!(document.FindChunk("DefinitionObjects") is GH_Chunk objects))
        {
            return false;
        }

        var dropped = false;
        foreach (var entry in objects.Chunks.OfType<GH_Chunk>())
        {
            if (!(entry.FindChunk("Container") is GH_Chunk container))
            {
                continue;
            }

            var id = entry.FindItem("GUID");
            var type = id != null && id.Type == GH_Types.gh_guid ? id._guid : Guid.Empty;
            if (type == GH_Scribble.ScribbleGuid)
            {
                dropped |= container.RemoveItem("Font");
            }
            else if (type == GH_Panel.PanelID)
            {
                // Where panels keep it now, and where they kept it before they had properties.
                dropped |= (container.FindChunk("PanelProperties") as GH_Chunk)?.RemoveChunk("Font") == true;
                dropped |= container.RemoveChunk("Font");
            }
            else
            {
                dropped |= DropInCluster(container);
            }
        }

        return dropped;
    }

    /// <summary>
    ///     A cluster carries a whole document as one byte array, which Grasshopper reads with the
    ///     cluster. It is rewritten only when a font came out of it.
    /// </summary>
    private static bool DropInCluster(GH_Chunk cluster)
    {
        var bytes = Bytes(cluster, "ClusterDocument");
        if (bytes == null && Bytes(cluster, "EncryptedDocument") is { } locked)
        {
            bytes = Unlock(locked, Bytes(cluster, "Key"));
        }

        if (bytes == null)
        {
            return false;
        }

        var document = new GH_LooseChunk("Document");
        try
        {
            document.Deserialize_Binary(bytes);
        }
        catch (Exception)
        {
            // Not a document Grasshopper wrote. It reports that itself when it reads the cluster.
            return false;
        }

        if (!Drop(document))
        {
            return false;
        }

        // Stored unlocked: Grasshopper reads "ClusterDocument" first, and the cluster keeps its
        // password, which is the "Key" item.
        cluster.RemoveItem("ClusterDocument");
        cluster.RemoveItem("EncryptedDocument");
        cluster.SetByteArray("ClusterDocument", document.Serialize_Binary());
        return true;
    }

    private static byte[]? Bytes(GH_Chunk chunk, string name)
    {
        var item = chunk.FindItem(name);
        return item != null && item.Type == GH_Types.gh_bytearray ? item._bytearray : null;
    }

    /// <summary>
    ///     How Grasshopper locks the document of a cluster that has a password: AES-128 in CBC
    ///     mode with PKCS7 padding. The key is the password hash repeated to 16 bytes, and the IV
    ///     is the same 16 bytes. Without a password the bytes are stored as they are.
    /// </summary>
    /// <returns>Null when the bytes don't unlock.</returns>
    private static byte[]? Unlock(byte[] locked, byte[]? password)
    {
        if (locked.Length == 0 || password == null || password.Length == 0)
        {
            return locked;
        }

        var key = new byte[16];
        for (var i = 0; i < key.Length; i++)
        {
            key[i] = password[i % password.Length];
        }

        try
        {
            using var aes = Aes.Create();
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            aes.Key = key;
            aes.IV = key;
            using var decryptor = aes.CreateDecryptor();
            return decryptor.TransformFinalBlock(locked, 0, locked.Length);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }
}
