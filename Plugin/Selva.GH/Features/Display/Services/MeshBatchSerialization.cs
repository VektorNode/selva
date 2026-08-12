using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Serializes a <see cref="DisplayBatch" /> for the binary mesh blob's metadata header, with the
///     binary payload stripped out (materials/groups/ids only). Used by both <see cref="MeshBatchProcessor" />
///     and <see cref="DisplayBatchTransformer" /> so the envelope is produced identically either way.
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
