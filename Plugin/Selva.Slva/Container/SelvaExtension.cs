using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     The "selva.gh" EXTN payload: JSON carrying the Rhino NURBS JSON behind each curve —
///     the one genuinely Grasshopper-specific thing in the container. Absent entirely for
///     batches without curve geometry, so the core chunks stay meaningful to a foreign reader.
/// </summary>
internal sealed class SelvaExtension
{
    /// <summary>Rhino NURBS JSON per curve, keyed by global object index (as a string).</summary>
    [JsonProperty("curves", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, string> Curves { get; set; }

    public static byte[] Build(List<DisplayItem> curves, int meshCount)
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

        if (curveJson == null)
        {
            return null;
        }

        var ext = new SelvaExtension { Curves = curveJson };
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
}
