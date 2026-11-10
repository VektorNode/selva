using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.ComputeIO.Goos;

/// <summary>
///     Rhino/GH-free wire shape for a runtime-computed value list: a target input id plus the
///     computed name -> value options. Single source of truth for both the local WebSocket collector
///     and the Rhino.Compute fork; <see cref="DynamicValueListGoo" /> wraps this in a GH_Goo.
///     <para>
///         The same channel carries two richer shapes, each optional. Options By adds <see cref="By" />
///         and <see cref="Table" />: the browser picks the table branch for the current value of the
///         <c>by</c> input, so changing it needs no solve. Repeat adds <see cref="Rows" /> and
///         <see cref="Members" />, has no target, and makes each member input take one value per row.
///     </para>
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

    /// <summary>Options By: id of the input whose value picks a branch of <see cref="Table" />.</summary>
    public string By { get; set; }

    /// <summary>Options By: option sets keyed by the <see cref="By" /> input's value, "*" as the fallback.</summary>
    public Dictionary<string, Dictionary<string, string>> Table { get; set; }

    /// <summary>Repeat: one entry per row, in order.</summary>
    public List<RepeatRow> Rows { get; set; }

    /// <summary>Repeat: ids of the inputs shown once per row. Each takes a JSON object of row key to pick.</summary>
    public List<string> Members { get; set; }

    /// <summary>
    ///     The output is wired into its target, so the target resolves its pick in the same solve. The
    ///     browser then shows the resolved pick and never sends a correction.
    /// </summary>
    public bool ResolvedInSolve { get; set; }

    /// <summary>
    ///     Options By: the options for each of By's items now, in item order. Read by the target in the
    ///     same solve; never sent, since the browser looks them up in <see cref="Table" />.
    /// </summary>
    public List<Dictionary<string, string>> ItemOptions { get; set; }

    /// <summary>
    ///     Wire shape: { "targetInputId": "&lt;guid&gt;" | null, "options": { name: value } }, plus
    ///     "by", "table", "rows", "members" and "resolvedInSolve" when set.
    /// </summary>
    public JObject ToJObject()
    {
        var obj = new JObject
        {
            { "targetInputId", TargetInputId == Guid.Empty ? null : TargetInputId.ToString() },
            { "options", ToJObject(Options) }
        };

        if (ResolvedInSolve)
        {
            obj["resolvedInSolve"] = true;
        }

        if (!string.IsNullOrEmpty(By))
        {
            obj["by"] = By;
        }

        if (Table != null)
        {
            var table = new JObject();
            foreach (var branch in Table)
            {
                table[branch.Key] = ToJObject(branch.Value);
            }

            obj["table"] = table;
        }

        if (Rows != null)
        {
            var rows = new JArray();
            foreach (var row in Rows)
            {
                rows.Add(new JObject { { "key", row.Key }, { "label", row.Label }, { "section", row.Section } });
            }

            obj["rows"] = rows;
        }

        if (Members != null)
        {
            var members = new JArray();
            foreach (var member in Members)
            {
                members.Add(member);
            }

            obj["members"] = members;
        }

        return obj;
    }

    public string ToComputeJson()
    {
        // Not JToken.ToString(Formatting.None): that overload's signature names a Newtonsoft type,
        // so it fails to resolve (MissingMethodException) when another Grasshopper plugin has
        // already loaded a different Newtonsoft.Json into the process. SerializeObject(object)
        // binds against any of them and defaults to Formatting.None.
        return JsonConvert.SerializeObject(ToJObject());
    }

    /// <summary>
    ///     Same shape as <see cref="ToJObject" />, as plain collections for the WebSocket serializer.
    /// </summary>
    public object ToCollectorPayload()
    {
        var payload = new Dictionary<string, object>
        {
            ["targetInputId"] = TargetInputId == Guid.Empty ? null : TargetInputId.ToString(),
            ["options"] = new Dictionary<string, string>(Options ?? new Dictionary<string, string>())
        };

        if (ResolvedInSolve)
        {
            payload["resolvedInSolve"] = true;
        }

        if (!string.IsNullOrEmpty(By))
        {
            payload["by"] = By;
        }

        if (Table != null)
        {
            payload["table"] = Table.ToDictionary(
                branch => branch.Key,
                branch => new Dictionary<string, string>(branch.Value ?? new Dictionary<string, string>()));
        }

        if (Rows != null)
        {
            payload["rows"] = Rows.Select(row => new Dictionary<string, string>
            {
                ["key"] = row.Key,
                ["label"] = row.Label,
                ["section"] = row.Section
            }).ToList();
        }

        if (Members != null)
        {
            payload["members"] = new List<string>(Members);
        }

        return payload;
    }

    public DynamicValueListPayload Clone()
    {
        return new DynamicValueListPayload(TargetInputId, Options)
        {
            By = By,
            Table = Table?.ToDictionary(branch => branch.Key,
                branch => new Dictionary<string, string>(branch.Value ?? new Dictionary<string, string>())),
            Rows = Rows?.ToList(),
            Members = Members?.ToList(),
            ResolvedInSolve = ResolvedInSolve,
            ItemOptions = ItemOptions?.Select(options => new Dictionary<string, string>(options)).ToList()
        };
    }

    public static DynamicValueListPayload FromJson(string json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return new DynamicValueListPayload();
        }

        var obj = JObject.Parse(json);
        var payload = new DynamicValueListPayload
        {
            TargetInputId = Guid.TryParse((string)obj["targetInputId"], out var guid) ? guid : Guid.Empty,
            Options = obj["options"]?.ToObject<Dictionary<string, string>>() ?? new Dictionary<string, string>(),
            By = (string)obj["by"],
            ResolvedInSolve = obj["resolvedInSolve"]?.Type == JTokenType.Boolean && (bool)obj["resolvedInSolve"]
        };

        if (obj["table"] is JObject table)
        {
            payload.Table = new Dictionary<string, Dictionary<string, string>>();
            foreach (var branch in table.Properties())
            {
                payload.Table[branch.Name] = branch.Value.ToObject<Dictionary<string, string>>()
                                             ?? new Dictionary<string, string>();
            }
        }

        if (obj["rows"] is JArray rows)
        {
            payload.Rows = rows.OfType<JObject>()
                .Select(row => new RepeatRow((string)row["key"], (string)row["label"], (string)row["section"]))
                .ToList();
        }

        if (obj["members"] is JArray members)
        {
            payload.Members = members.Select(member => (string)member).Where(id => id != null).ToList();
        }

        return payload;
    }

    private static JObject ToJObject(Dictionary<string, string> options)
    {
        var obj = new JObject();
        if (options != null)
        {
            foreach (var kvp in options)
            {
                obj[kvp.Key] = kvp.Value;
            }
        }

        return obj;
    }
}

/// <summary>One row of a Repeat: a stable key, the label shown, and the section it is listed under.</summary>
public sealed class RepeatRow
{
    public RepeatRow(string key, string label = null, string section = null)
    {
        Key = key;
        Label = label;
        Section = section;
    }

    public string Key { get; }
    public string Label { get; }
    public string Section { get; }
}
