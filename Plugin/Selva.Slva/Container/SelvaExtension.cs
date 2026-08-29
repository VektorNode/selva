using System.Collections.Generic;
using System.IO;
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
        var ns = Encoding.UTF8.GetBytes(SlvmDocument.SelvaGhNamespace);
        using (var ms = new MemoryStream())
        {
            Varint.Write(ms, (uint)ns.Length);
            ms.Write(ns, 0, ns.Length);
            ms.Write(payload, 0, payload.Length);
            return ms.ToArray();
        }
    }

    public static SelvaExtension Read(List<(uint type, byte[] payload)> chunks)
    {
        foreach (var (type, payload) in chunks)
        {
            if (type != SlvmDocument.ChunkExtn)
            {
                continue;
            }

            var pos = 0;
            var nsLen = (int)Varint.Read(payload, ref pos);
            var ns = Encoding.UTF8.GetString(payload, pos, nsLen);
            pos += nsLen;
            if (ns != SlvmDocument.SelvaGhNamespace)
            {
                continue;
            }

            var json = Encoding.UTF8.GetString(payload, pos, payload.Length - pos);
            return JsonConvert.DeserializeObject<SelvaExtension>(json);
        }

        return null;
    }
}
