using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.ComputeIO.Goos;

/// <summary>
///     Rhino/GH-free wire shape for a runtime-computed value list: a target input id plus the
///     computed name -> value options. Single source of truth for both the local WebSocket collector
///     and the Rhino.Compute fork; <see cref="DynamicValueListGoo" /> wraps this in a GH_Goo.
/// </summary>
public sealed class DynamicValueListPayload
{
    public DynamicValueListPayload()
    {
        Options = new Dictionary<string, string>();
    }

    public DynamicValueListPayload(Guid targetInputId, IDictionary<string, string> options)
    {
        TargetInputId = targetInputId;
        Options = options != null
            ? new Dictionary<string, string>(options)
            : new Dictionary<string, string>();
    }

    /// <summary>
    ///     Instance GUID of the Dynamic Value List input these options populate. Empty when unset.
    /// </summary>
    public Guid TargetInputId { get; set; } = Guid.Empty;

    public Dictionary<string, string> Options { get; set; }

    /// <summary>
    ///     Wire shape: { "targetInputId": "&lt;guid&gt;" | null, "options": { name: value } }.
    /// </summary>
    public JObject ToJObject()
    {
        var options = new JObject();
        if (Options != null)
        {
            foreach (var kvp in Options)
            {
                options[kvp.Key] = kvp.Value;
            }
        }

        return new JObject
        {
            { "targetInputId", TargetInputId == Guid.Empty ? null : TargetInputId.ToString() },
            { "options", options }
        };
    }

    public string ToComputeJson()
    {
        return ToJObject().ToString(Formatting.None);
    }

    /// <summary>
    ///     Same shape as <see cref="ToJObject" />, as a plain object for the WebSocket serializer.
    /// </summary>
    public object ToCollectorPayload()
    {
        return new
        {
            targetInputId = TargetInputId == Guid.Empty ? null : TargetInputId.ToString(),
            options = new Dictionary<string, string>(Options ?? new Dictionary<string, string>())
        };
    }

    public static DynamicValueListPayload FromJson(string json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return new DynamicValueListPayload();
        }

        var obj = JObject.Parse(json);
        return new DynamicValueListPayload
        {
            TargetInputId = Guid.TryParse((string)obj["targetInputId"], out var guid) ? guid : Guid.Empty,
            Options = obj["options"]?.ToObject<Dictionary<string, string>>() ?? new Dictionary<string, string>()
        };
    }
}
