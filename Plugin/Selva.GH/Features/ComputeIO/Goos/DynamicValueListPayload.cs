using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.ComputeIO.Goos;

/// <summary>
///     Rhino/GH-free routing payload for a runtime-computed value list: a target input id plus the
///     computed name -> value options. This is the single source of truth for the wire shape both the
///     local WebSocket collector and the Rhino.Compute fork emit, so it can be unit-tested without a
///     Grasshopper runtime. <see cref="DynamicValueListGoo" /> is a thin GH_Goo wrapper over this.
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

    /// <summary>
    ///     Computed options (name -> value).
    /// </summary>
    public Dictionary<string, string> Options { get; set; }

    /// <summary>
    ///     The collector/client contract: { "targetInputId": "&lt;guid&gt;" | null, "options": { name: value } }.
    ///     A single object shape so the local path and the compute path can never drift.
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
    ///     The shape the local collector hands to the WebSocket serializer (an anonymous-equivalent
    ///     object with the same property names as <see cref="ToJObject" />). Kept here so the local
    ///     path and the compute path provably agree.
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
