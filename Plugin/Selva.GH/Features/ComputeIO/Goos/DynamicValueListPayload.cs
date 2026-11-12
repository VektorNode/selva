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
///         The same channel carries two richer shapes, each optional and without a target. Repeat adds
///         <see cref="Rows" /> and <see cref="Members" />, and makes each member input take one value
///         per row. Options Table adds <see cref="PickTable" />: the browser narrows it by the picks on
///         screen, so changing one needs no solve to update the lists that depend on it.
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

    /// <summary>Repeat: one entry per row, in order.</summary>
    public List<RepeatRow> Rows { get; set; }

    /// <summary>Repeat: ids of the inputs shown once per row. Each takes a JSON object of row key to pick.</summary>
    public List<string> Members { get; set; }

    /// <summary>
    ///     The output is wired into its target, so the target resolves its pick in the same solve. The
    ///     browser then shows the resolved pick and never sends a correction.
    /// </summary>
    public bool ResolvedInSolve { get; set; }

    /// <summary>Options Table: the valid combinations for inputs that depend on each other.</summary>
    public PickTable PickTable { get; set; }

    /// <summary>
    ///     Wire shape: { "targetInputId": "&lt;guid&gt;" | null, "options": { name: value } }, plus
    ///     "rows", "members", "pickTable" and "resolvedInSolve" when set.
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

        if (PickTable != null)
        {
            var rows = new JArray();
            foreach (var row in PickTable.Rows)
            {
                rows.Add(new JArray(row));
            }

            var table = new JObject
            {
                { "inputs", new JArray(PickTable.Inputs) },
                { "parents", new JArray(PickTable.Parents) },
                { "rows", rows }
            };
            if (PickTable.By.Count > 0)
            {
                table["by"] = new JArray(PickTable.By);
            }

            obj["pickTable"] = table;
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

        if (PickTable != null)
        {
            var table = new Dictionary<string, object>
            {
                ["inputs"] = new List<string>(PickTable.Inputs),
                ["parents"] = new List<int>(PickTable.Parents),
                ["rows"] = PickTable.Rows.Select(row => new List<string>(row)).ToList()
            };
            if (PickTable.By.Count > 0)
            {
                table["by"] = new List<string>(PickTable.By);
            }

            payload["pickTable"] = table;
        }

        return payload;
    }

    public DynamicValueListPayload Clone()
    {
        return new DynamicValueListPayload(TargetInputId, Options)
        {
            Rows = Rows?.ToList(),
            Members = Members?.ToList(),
            ResolvedInSolve = ResolvedInSolve,
            PickTable = PickTable?.Clone()
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
            ResolvedInSolve = obj["resolvedInSolve"]?.Type == JTokenType.Boolean && (bool)obj["resolvedInSolve"]
        };

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

        if (obj["pickTable"] is JObject pickTable)
        {
            payload.PickTable = new PickTable
            {
                Inputs = pickTable["inputs"]?.ToObject<List<string>>() ?? new List<string>(),
                Parents = pickTable["parents"]?.ToObject<List<int>>() ?? new List<int>(),
                By = pickTable["by"]?.ToObject<List<string>>() ?? new List<string>(),
                Rows = pickTable["rows"]?.ToObject<List<List<string>>>() ?? new List<List<string>>()
            };
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

/// <summary>
///     The valid combinations for a set of inputs. Each input offers the values its cell still has in
///     the rows matching the picks it depends on: the inputs in <see cref="By" />, then the input it
///     is wired from, the one that is wired from, and so on.
/// </summary>
public sealed class PickTable
{
    /// <summary>Ids of the inputs that narrow the rows without being filled from them.</summary>
    public List<string> By { get; set; } = new List<string>();

    /// <summary>Ids of the inputs the table fills, a parent before its children.</summary>
    public List<string> Inputs { get; set; } = new List<string>();

    /// <summary>
    ///     For each of <see cref="Inputs" />, the index of the input whose pick it narrows on, or -1
    ///     for one that only <see cref="By" /> narrows.
    /// </summary>
    public List<int> Parents { get; set; } = new List<int>();

    /// <summary>
    ///     One entry per valid combination: a cell for each of <see cref="By" />, then one for each of
    ///     <see cref="Inputs" />.
    /// </summary>
    public List<List<string>> Rows { get; set; } = new List<List<string>>();

    /// <summary>
    ///     The rows matching what the <see cref="By" /> inputs hold in this solve: one set, or one per
    ///     item when a By input is repeated. Where an input with no parent starts. Grasshopper-side
    ///     only: never sent, since the browser narrows <see cref="Rows" /> itself.
    /// </summary>
    public List<List<List<string>>> Start { get; set; }

    public PickTable Clone()
    {
        return new PickTable
        {
            By = By.ToList(),
            Inputs = Inputs.ToList(),
            Parents = Parents.ToList(),
            Rows = Rows.Select(row => row.ToList()).ToList(),
            Start = Start?.Select(set => set.Select(row => row.ToList()).ToList()).ToList()
        };
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
