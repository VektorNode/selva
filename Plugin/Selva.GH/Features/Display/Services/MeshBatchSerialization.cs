using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Serializes a <see cref="DisplayBatch" /> for the binary mesh blob's metadata header, with the
///     binary payload stripped out (materials/groups/ids only). Only the legacy re-encode path in
///     <see cref="DisplayBatchTransformer" /> still needs it: SLVM v2 blobs carry their metadata
///     in the container's TABL chunk instead of embedded JSON.
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
