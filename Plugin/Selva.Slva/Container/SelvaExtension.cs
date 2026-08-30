using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     The "selva.gh" EXTN payload: JSON with the batch id and the Rhino NURBS JSON behind each
///     curve. Everything Grasshopper-specific in the container lives here, so the core chunks
///     stay meaningful to a foreign reader.
/// </summary>
internal sealed class SelvaExtension
{
    /// <summary>
    ///     The batch's identity namespace — see <see cref="DisplayBatch.BatchId" />. v2 is new,
    ///     so it uses the accurate name here; the legacy <c>sourceComponentId</c> spelling below
    ///     is still read, because a batch decoded from a pre-v2 blob and rewritten as v2 would
    ///     otherwise lose its identity (and with it every hidden/selected object in the viewer).
    /// </summary>
    [JsonProperty("batchId", NullValueHandling = NullValueHandling.Ignore)]
    public string BatchId { get; set; }

    /// <summary>Read-only alias for containers written before the field was renamed.</summary>
    [JsonProperty("sourceComponentId", NullValueHandling = NullValueHandling.Ignore)]
    public string LegacyBatchId { get; set; }

    /// <summary>Rhino NURBS JSON per curve, keyed by global object index (as a string).</summary>
    [JsonProperty("curves", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, string> Curves { get; set; }

    public static byte[] Build(string batchId, List<DisplayItem> curves, int meshCount)
    {
        Dictionary<string, string> curveJson = null;
        if (curves != null)
        {
            for (var c = 0; c < curves.Count; c++)
            {
                if (string.IsNullOrEmpty(curves[c].Json))
                {
                    continue;
                }

                curveJson ??= new Dictionary<string, string>();
                // Keyed by global object index: curves sit right after the meshes.
                curveJson[(meshCount + c).ToString(System.Globalization.CultureInfo.InvariantCulture)] =
                    curves[c].Json;
            }
        }

        return Build(batchId, curveJson);
    }

    public static byte[] Build(string batchId, Dictionary<string, string> curveJson)
    {
        if (batchId == null && (curveJson == null || curveJson.Count == 0))
        {
            return null;
        }

        var ext = new SelvaExtension { BatchId = batchId, Curves = curveJson };
        var payload = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(ext));
        return ExtensionChunk.Encode(SlvmDocument.SelvaGhNamespace, payload);
    }

    public static SelvaExtension Read(List<(uint type, byte[] payload)> chunks)
    {
        foreach (var (type, payload) in chunks)
        {
            if (type != SlvmDocument.ChunkExtn)
            {
                continue;
            }

            var (ns, body) = ExtensionChunk.Decode(payload);
            if (ns != SlvmDocument.SelvaGhNamespace)
            {
                continue;
            }

            return JsonConvert.DeserializeObject<SelvaExtension>(Encoding.UTF8.GetString(body));
        }

        return null;
    }

    /// <summary>True when this EXTN chunk payload carries the selva.gh namespace.</summary>
    public static bool Owns(byte[] chunkPayload)
    {
        return ExtensionChunk.Decode(chunkPayload).ns == SlvmDocument.SelvaGhNamespace;
    }
}
