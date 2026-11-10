using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Goos;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter whose options are populated at runtime rather than read from a wired
///     GH_ValueList. The options are computed by a <see cref="GH_DynamicValueListOutput" /> that targets
///     this parameter.
///     <para>
///         Wired from that output (Set Dynamic Value List, Options By, Repeat), the param knows its
///         options inside the solve that computes them and resolves the pick there: one solve per
///         change, however long the chain. Unwired, it passes the pick through and the web UI corrects
///         it one solve later.
///     </para>
/// </summary>
public class GetDynamicValueListParameter : SelvaContextualParameter<GH_ValueListDataGoo>
{
    // Name -> expression, from the last LoadItems call. Persisted so a saved document round-trips
    // its last-known options for Rhino.Compute.
    private List<(string Name, string Expression)> _storedItems = new List<(string Name, string Expression)>();

    // Row keys from a wired Repeat; null when this input isn't repeated.
    private List<string> _rowKeys;

    public GetDynamicValueListParameter()
        : base("Get Dynamic Value List", "Get DynVL", "Get a value from a runtime-computed value list",
            GH_ParamAccess.item)
    {
    }

    // Reuse "ValueList" so Rhino.Compute reports this param like a static value list — the dynamic
    // vs. static distinction is carried by the CLR class name (ResolveParameterTypeName keys on that,
    // not on TypeName).
    public override string TypeName => "ValueList";
    public override Guid ComponentGuid => new Guid("9F2C4B7E-3A8D-4C1F-B6E5-2D7A9C0E1F34");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.GetDynamicValueList);

    [JsonProperty("values")]
    public Dictionary<string, string> Values => DynamicValueListLogic.ToValuesDictionary(_storedItems);

    /// <summary>
    ///     Enable list/multi-select mode (driven by the schema's `displayAs: 'checklist'`).
    /// </summary>
    public void SetListAccess(bool listAccess)
    {
        Access = listAccess ? GH_ParamAccess.list : GH_ParamAccess.item;
        AtMost = DynamicValueListLogic.ResolveAtMost(listAccess, AtMost);
    }

    public override bool AutoAssignContextualData(GH_ParameterContext context)
    {
        if (_storedItems.Count == 0)
        {
            return true;
        }

        var picked = Utils.PickOptions(ImpliedPrompt, _storedItems.Select(item => item.Name).ToList(), AtMost);
        if (picked == null || picked.Count == 0)
        {
            return false;
        }

        AssignContextualData(picked);
        return true;
    }

    // Rhino.Compute builds without the generic contextual handler call these by reflection.
    public void SetValue(string value)
    {
        SetValues(new[] { value });
    }

    public void SetValues(IEnumerable<string> values)
    {
        AssignContextualData(values.ToList());
    }

    /// <summary>
    ///     Records the selected value so it flows downstream on the next solve. Unlike the static
    ///     value list, options here are computed each solve, so there's no authoritative list to
    ///     validate against: any non-empty value is accepted as-is. Returns true if recorded.
    /// </summary>
    public bool SelectItemByName(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        SetValue(value);
        return true;
    }

    /// <summary>
    ///     Records multiple selected values (checklist mode). Returns true if any non-empty value
    ///     was recorded.
    /// </summary>
    public bool SelectItemsByName(IEnumerable<string> values)
    {
        var valueList = DynamicValueListLogic.FilterSelectableValues(values);
        if (valueList.Count == 0)
        {
            return false;
        }

        SetValues(valueList);
        return true;
    }

    /// <summary>
    ///     Populates known options from a name -> expression dictionary. Called by the web UI
    ///     before applying a selection, so the selection can be matched against current options.
    /// </summary>
    public void LoadItems(Dictionary<string, string> options)
    {
        if (options == null)
        {
            return;
        }

        _storedItems = options.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    /// <summary>Returns the currently-selected value, or the first known option, or empty.</summary>
    public string GetDefaultValue()
    {
        if (_rowKeys != null)
        {
            // A repeated input's value is its row picks, never one option.
            var picks = SelectedValues()?.FirstOrDefault();
            return DynamicValueListLogic.ParseRowPicks(picks).Count > 0 ? picks : "{}";
        }

        var selected = SelectedValues()?.Select(value => ToGoo(value).Value).ToList();
        return DynamicValueListLogic.GetDefaultValue(selected, _storedItems);
    }

    protected override void CollectVolatileData_FromSources()
    {
        var wired = ReadWiredOptions();
        if (!wired.Found)
        {
            _rowKeys = null;
            base.CollectVolatileData_FromSources();
            return;
        }

        m_data.Clear();
        _rowKeys = wired.RowKeys;
        if (wired.OptionSets.Count > 0)
        {
            _storedItems = wired.OptionSets[0];
        }

        var picks = SelectedValues() ?? new List<string>();
        var optionSets = wired.OptionSets.Cast<IReadOnlyList<(string, string)>>().ToList();
        List<ResolvedPick> resolved;
        if (_rowKeys != null)
        {
            resolved = DynamicValueListLogic.ResolveRows(_rowKeys,
                DynamicValueListLogic.ParseRowPicks(picks.FirstOrDefault()), optionSets);
        }
        else if (Access == GH_ParamAccess.list)
        {
            resolved = DynamicValueListLogic.ResolvePicks(optionSets.FirstOrDefault(), picks);
        }
        else
        {
            resolved = new List<ResolvedPick>
            {
                DynamicValueListLogic.ResolvePick(optionSets.FirstOrDefault(), picks.FirstOrDefault())
            };
        }

        var path = new GH_Path(0);
        for (var i = 0; i < resolved.Count; i++)
        {
            var options = wired.OptionSets.Count == 0
                ? _storedItems
                : wired.OptionSets[Math.Min(i, wired.OptionSets.Count - 1)];
            m_data.Append(new GH_ValueListDataGoo(resolved[i].Expression, options, resolved[i].Index, allowEmpty: true),
                path);
        }

        var replaced = resolved.Count(pick => pick.Replaced);
        if (replaced > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"{replaced} pick(s) aren't offered now, so they take the first option. They come back when offered again.");
        }
    }

    /// <summary>
    ///     The options and rows wired in from Selva's option components. Found is false when none is
    ///     wired: a Panel of "key" = value pairs only seeds options, and resolves nothing.
    /// </summary>
    private (bool Found, List<string> RowKeys, List<List<(string Name, string Expression)>> OptionSets)
        ReadWiredOptions()
    {
        var found = false;
        List<string> rowKeys = null;
        var optionSets = new List<List<(string Name, string Expression)>>();
        foreach (var source in Sources)
        {
            var data = source?.VolatileData;
            if (data == null || data.IsEmpty)
            {
                continue;
            }

            foreach (var goo in data.AllData(true))
            {
                var inner = goo is GH_ObjectWrapper wrapper ? wrapper.Value : goo;
                if (inner is not DynamicValueListGoo dvl || !IsFor(dvl.Payload))
                {
                    continue;
                }

                found = true;
                var payload = dvl.Payload;
                if (payload.Rows != null)
                {
                    rowKeys = payload.Rows.Select(row => row.Key).ToList();
                }
                else if (payload.ItemOptions is { Count: > 0 })
                {
                    optionSets.AddRange(payload.ItemOptions.Select(ToItems));
                }
                else
                {
                    optionSets.Add(ToItems(payload.Options));
                }
            }
        }

        return (found, rowKeys, optionSets);
    }

    // An output wired into several inputs fills only its target; the others must not resolve
    // against options the browser never shows them.
    private bool IsFor(DynamicValueListPayload payload)
    {
        return payload.Rows != null
            ? payload.Members?.Contains(InstanceGuid.ToString()) == true
            : payload.TargetInputId == InstanceGuid;
    }

    private static List<(string Name, string Expression)> ToItems(Dictionary<string, string> options)
    {
        return options?.Select(kvp => (kvp.Key, kvp.Value)).ToList() ?? new List<(string Name, string Expression)>();
    }

    // Assigned values stay raw strings and resolve here, at emit time, against whatever options are
    // current then: a wired initial-options source is read in BeforeCollect, which can run after the
    // apply, so resolving at apply time would freeze an unmatched value.
    protected override IEnumerable<GH_ValueListDataGoo> FromContextual(object value)
    {
        var stringValue = ExtractStringValue(value);
        if (stringValue != null)
        {
            yield return ToGoo(stringValue);
        }
    }

    // Read wired initial options before any selection resolves, or a selection applied earlier in
    // this solve resolves against an empty option set and emits the raw name instead of its expression.
    protected override void BeforeCollect()
    {
        var initialOptions = ReadInitialOptionsFromSources();
        if (initialOptions.Count > 0)
        {
            _storedItems = initialOptions;
        }
    }

    // This param is usually unwired (its value comes from the web UI), so both paths emit the default.
    protected override void CollectFromSources()
    {
        AppendDefault();
    }

    protected override void CollectWithoutSources()
    {
        AppendDefault();
    }

    /// <summary>
    ///     No selection yet: the first known option, else a single empty string so the output is never
    ///     "no data" — replaced once a computed value arrives from the UI.
    /// </summary>
    private void AppendDefault()
    {
        if (_storedItems.Count > 0)
        {
            var first = _storedItems[0];
            m_data.Append(new GH_ValueListDataGoo(first.Expression, _storedItems, 0), new GH_Path(0));
            return;
        }

        // allowEmpty keeps the empty goo valid so downstream doesn't drop it.
        m_data.Append(new GH_ValueListDataGoo(string.Empty, _storedItems, -1, allowEmpty: true), new GH_Path(0));
    }

    /// <summary>
    ///     Wraps a selected value in a goo, mapping it to a known option's expression when one
    ///     matches, otherwise passing it through verbatim.
    /// </summary>
    private GH_ValueListDataGoo ToGoo(string value)
    {
        var (expression, matchIndex) = DynamicValueListLogic.ResolveExpression(_storedItems, value);
        return new GH_ValueListDataGoo(expression, _storedItems, matchIndex);
    }

    private List<string> SelectedValues()
    {
        var values = ContextualData.Select(ExtractStringValue).Where(value => value != null).ToList();
        return values.Count > 0 ? values : null;
    }

    /// <summary>
    ///     Reads "key" = value pair strings from wired sources into an ordered (Name, Expression)
    ///     list — lets the author wire a Panel of pairs to seed options before the web UI computes any.
    /// </summary>
    private List<(string Name, string Expression)> ReadInitialOptionsFromSources()
    {
        var options = new List<(string Name, string Expression)>();
        if (Sources == null || Sources.Count == 0)
        {
            return options;
        }

        foreach (var source in Sources)
        {
            var sourceData = source.VolatileData;
            if (sourceData == null || sourceData.IsEmpty)
            {
                continue;
            }

            var lines = sourceData.AllData(true)
                .Select(ExtractStringValue)
                .Where(s => !string.IsNullOrWhiteSpace(s));

            foreach (var pair in OptionPairParser.Parse(lines))
            {
                options.Add((pair.Key, pair.Value));
            }
        }

        return options;
    }

    private static string ExtractStringValue(object item)
    {
        return item switch
        {
            null => null,
            GH_ValueListDataGoo vld => vld.Value,
            GH_String ghString => ghString.Value,
            string str => str,
            IGH_Goo goo when goo.CastTo(out string castValue) => castValue,
            IGH_Goo goo => goo.ToString(),
            _ => item.ToString()
        };
    }

    public override bool Write(GH_IWriter writer)
    {
        writer.SetBoolean("ListAccess", Access == GH_ParamAccess.list);

        var itemsJson = new JArray();
        foreach (var item in _storedItems)
        {
            itemsJson.Add(new JObject
            {
                { "name", item.Name },
                { "expression", item.Expression }
            });
        }

        writer.SetString("StoredItems", itemsJson.ToString());

        // Persist the raw applied strings (not resolved expressions) so the selection re-resolves
        // against the option set on the next solve, same as a live apply. Without this the
        // selection is lost on load and the param emits an empty placeholder until re-applied.
        var selectedValues = SelectedValues();
        if (selectedValues != null)
        {
            writer.SetString("SelectedValues", new JArray(selectedValues).ToString());
        }

        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        // Settings first: SetListAccess below adjusts the AtMost they restore.
        var result = base.Read(reader);

        var listAccess = false;
        if (reader.TryGetBoolean("ListAccess", ref listAccess))
        {
            SetListAccess(listAccess);
        }

        string itemsJson = null;
        if (reader.TryGetString("StoredItems", ref itemsJson) && !string.IsNullOrEmpty(itemsJson))
        {
            try
            {
                var array = JArray.Parse(itemsJson);
                _storedItems.Clear();
                foreach (var item in array)
                {
                    _storedItems.Add((
                        item["name"]?.ToString() ?? "",
                        item["expression"]?.ToString() ?? ""
                    ));
                }
            }
            catch
            {
                // Ignore parse errors
            }
        }

        string selectedJson = null;
        if (reader.TryGetString("SelectedValues", ref selectedJson) && !string.IsNullOrEmpty(selectedJson))
        {
            try
            {
                var array = JArray.Parse(selectedJson);
                SetValues(array.Select(token => token?.ToString() ?? string.Empty));
            }
            catch
            {
                // Ignore parse errors
            }
        }

        return result;
    }
}
