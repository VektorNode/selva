using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Shared helper for embedding a <see cref="DisplayBatch" />'s envelope inside the binary mesh
///     blob's metadata header. The blob carries a self-contained copy of the batch (materials,
///     groups, ids) WITHOUT its own binary payload, so the format stays transport-agnostic and the
///     client decoder never branches on transport. Both <see cref="MeshBatchProcessor" /> (initial
///     encode) and <see cref="DisplayBatchTransformer" /> (re-encode after a transform) use this so
///     the envelope is produced identically in both places.
/// </summary>
public static class MeshBatchSerialization
{
    public static string SerializeMetadata(DisplayBatch batch)
    {
        var savedBlob = batch.CompressedData;
        batch.CompressedData = null;
        try
        {
            return JsonConvert.SerializeObject(batch);
        }
        finally
        {
            batch.CompressedData = savedBlob;
        }
    }
}
