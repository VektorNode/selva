using System;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>The open document as the bytes of a .gh file, for a copy that leaves this computer.</summary>
internal static class DefinitionArchive
{
    /// <summary>
    ///     The Selva links are dropped from the copy: they name every instance this file went to,
    ///     which its users have no need to see. UI thread only.
    /// </summary>
    public static byte[] Serialize(GH_Document document)
    {
        var archive = new GH_Archive();
        archive.CreateNewRoot(true);
        if (!archive.AppendObject(document, "Definition"))
        {
            throw new InvalidOperationException("Grasshopper couldn't serialise the definition.");
        }

        RemoveLinks(archive.GetRootNode);
        return archive.Serialize_Binary();
    }

    private static void RemoveLinks(GH_Chunk chunk)
    {
        if (chunk.ItemExists(SelvaDefinitionLinks.ArchiveItem))
        {
            chunk.RemoveItem(SelvaDefinitionLinks.ArchiveItem);
        }

        foreach (var child in chunk.Chunks.OfType<GH_Chunk>())
        {
            RemoveLinks(child);
        }
    }
}
