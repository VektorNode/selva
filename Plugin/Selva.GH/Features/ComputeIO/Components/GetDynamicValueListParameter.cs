using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
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
///     this parameter; the web UI applies the user's selection back here on the next solve.
/// </summary>
public class GetDynamicValueListParameter : GH_Param<GH_ValueListDataGoo>, IGH_ContextualParameter
{
    private GH_ValueListDataGoo[] _contextual;
    private DataTree<GH_ValueListDataGoo> _contextualDataTree;

    // Raw value strings as applied by the UI. Kept separately from _contextual so the selection
    // re-resolves against the option set at emit time, not at apply time: if a wired
    // initial-options source populates _storedItems on the same solve, the apply can run before
    // those options are read, so resolving eagerly would freeze the unmatched value. See EmitData.
    private List<string> _selectedValues;

    // Name -> expression from the last LoadItems call. Persisted so a saved document round-trips
    // its last-known options for Rhino.Compute.
    private List<(string Name, string Expression)> _storedItems = new List<(string Name, string Expression)>();

    public GetDynamicValueListParameter()
        : base("Get Dynamic Value List", "Get DynVL", "Get a value from a runtime-computed value list", "Params",
            "Util", GH_ParamAccess.item)
    {
    }


    public override GH_Exposure Exposure => GH_Exposure.quinary;

    // Reuse "ValueList" so Rhino.Compute's existing ValueList input case handles this param
    // unmodified — the dynamic vs. static distinction is carried by the CLR class name
    // (ResolveParameterTypeName keys on that, not on TypeName).
    public override string TypeName => "ValueList";
    public override Guid ComponentGuid => new Guid("9F2C4B7E-3A8D-4C1F-B6E5-2D7A9C0E1F34");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.GetValueList);

    public bool TreeAccess { get; set; }

    [JsonProperty("values")]
    public Dictionary<string, string> Values => DynamicValueListLogic.ToValuesDictionary(_storedItems);

    // IGH_ContextualParameter properties
    public string Prompt { get; set; } = string.Empty;
    public int AtLeast { get; set; } = 1;
    public int AtMost { get; set; } = 1;
    public bool Immediate { get; set; } = true;

    // Enable list/multi-select mode (driven by the schema's `displayAs: 'checklist'`).
    public void SetListAccess(bool listAccess)
    {
        Access = listAccess ? GH_ParamAccess.list : GH_ParamAccess.item;
        AtMost = DynamicValueListLogic.ResolveAtMost(listAccess, AtMost);
    }

    public IEnumerable<object> ContextualData
    {
        get
        {
            if (_contextual != null)
            {
                foreach (var goo in _contextual)
                {
                    yield return goo;
                }
            }
        }
    }

    public void AssignContextualData(IEnumerable data)
    {
        var values = new List<string>();
        foreach (var item in data)
        {
            var stringValue = ExtractStringValue(item);
            if (stringValue != null)
            {
                values.Add(stringValue);
            }
        }

        SetValues(values);
    }

    public bool AutoAssignContextualData(GH_ParameterContext context)
    {
        return _contextual != null && _contextual.Length > 0;
    }

    // Assigns contextual data as a tree. Called by Rhino.Compute via reflection.
    public void AssignContextualDataTree(DataTree<GH_ValueListDataGoo> data)
    {
        _contextualDataTree = data;
        ExpireSolution(false);
    }

    // Sets a single string value directly. Called from Rhino.Compute via reflection.
    public void SetValue(string value)
    {
        SetValues(new[] { value });
    }

    // Sets one or more string values directly. Called from Rhino.Compute via reflection.
    public void SetValues(IEnumerable<string> values)
    {
        // The goos are (re)built lazily in EmitData, against whatever options are current then —
        // not _storedItems as it stood at apply time (empty if the apply precedes reading a wired
        // initial-options source on the same solve).
        _selectedValues = values.ToList();
        _contextual = _selectedValues.Select(ToGoo).ToArray();
        ExpireSolution(false);
    }

    // Wraps a selected value in a goo, mapping it to a known option's expression when one
    // matches, otherwise passing it through verbatim.
    private GH_ValueListDataGoo ToGoo(string value)
    {
        var (expression, matchIndex) = DynamicValueListLogic.ResolveExpression(_storedItems, value);
        return new GH_ValueListDataGoo(expression, _storedItems, matchIndex);
    }

    // Records the selected value so it flows downstream on the next solve. Unlike the static
    // value list, options here are computed each solve, so there's no authoritative list to
    // validate against: any non-empty value is accepted as-is.
    public bool SelectItemByName(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        SetValue(value);
        return true;
    }

    // Records multiple selected values (checklist mode).
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

    // Populates known options from a name -> expression dictionary. Called by the web UI
    // before applying a selection, so the selection can be matched against current options.
    public void LoadItems(Dictionary<string, string> options)
    {
        if (options == null)
        {
            return;
        }

        _storedItems = options.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    public void ClearContextualData()
    {
        _contextual = null;
        _contextualDataTree = null;
        _selectedValues = null;
    }

    // Returns the currently-selected value, or the first known option, or empty.
    public string GetDefaultValue()
    {
        var selected = _contextual?.Select(goo => goo.Value).ToList();
        return DynamicValueListLogic.GetDefaultValue(selected, _storedItems);
    }

    // Grasshopper calls _Custom when the param has NO wired sources, and _FromSources when it does.
    // This param is usually unwired (its value comes from the web UI), so both must emit our data.
    protected override void CollectVolatileData_Custom()
    {
        EmitData();
    }

    protected override void CollectVolatileData_FromSources()
    {
        EmitData();
    }

    // Populates volatile data. Precedence: a UI selection (contextual data / tree), then a
    // wired initial value list (emits its first item as default), then a single empty string
    // so the output is never "no data": replaced once a computed value arrives from the UI.
    private void EmitData()
    {
        m_data.Clear();

        // Read wired initial options before resolving any selection — otherwise a selection
        // applied earlier in this solve (before sources were read) resolves against an empty
        // option set and emits the raw name instead of its expression.
        var initialOptions = ReadInitialOptionsFromSources();
        if (initialOptions.Count > 0)
        {
            _storedItems = initialOptions;
        }

        if (_selectedValues != null)
        {
            _contextual = _selectedValues.Select(ToGoo).ToArray();
            m_data.AppendRange(_contextual, new GH_Path(0));
            return;
        }

        if (_contextualDataTree != null)
        {
            for (var i = 0; i < _contextualDataTree.BranchCount; i++)
            {
                m_data.AppendRange(_contextualDataTree.Branches[i], _contextualDataTree.Paths[i]);
            }

            return;
        }

        // No selection yet: emit the first wired option as the default when one exists.
        if (_storedItems.Count > 0)
        {
            var first = _storedItems[0];
            m_data.Append(new GH_ValueListDataGoo(first.Expression, _storedItems, 0), new GH_Path(0));
            return;
        }

        // allowEmpty keeps the empty goo valid so downstream doesn't drop it.
        m_data.Append(new GH_ValueListDataGoo(string.Empty, _storedItems, -1, allowEmpty: true), new GH_Path(0));
    }

    // Reads "key" = value pair strings from wired sources into an ordered (Name, Expression)
    // list: lets the author wire a Panel of pairs to seed options before the web UI computes any.
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
        writer.SetString("Prompt", Prompt ?? string.Empty);
        writer.SetInt32("AtLeast", AtLeast);
        writer.SetInt32("AtMost", AtMost);
        writer.SetBoolean("TreeAccess", TreeAccess);
        writer.SetBoolean("ListAccess", Access == GH_ParamAccess.list);
        writer.SetBoolean("Immediate", Immediate);

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
        // against the option set on the next solve, same as a live apply. Without this it's lost
        // on load and the param emits an empty placeholder until re-applied.
        if (_selectedValues != null)
        {
            var selectedJson = new JArray();
            foreach (var value in _selectedValues)
            {
                selectedJson.Add(value ?? string.Empty);
            }

            writer.SetString("SelectedValues", selectedJson.ToString());
        }

        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        Prompt = reader.GetString("Prompt");

        var atLeast = 1;
        if (reader.TryGetInt32("AtLeast", ref atLeast))
        {
            AtLeast = atLeast;
        }

        var atMost = 1;
        if (reader.TryGetInt32("AtMost", ref atMost))
        {
            AtMost = atMost;
        }

        var treeAccess = false;
        if (reader.TryGetBoolean("TreeAccess", ref treeAccess))
        {
            TreeAccess = treeAccess;
        }

        var listAccess = false;
        if (reader.TryGetBoolean("ListAccess", ref listAccess))
        {
            SetListAccess(listAccess);
        }

        var immediate = true;
        if (reader.TryGetBoolean("Immediate", ref immediate))
        {
            Immediate = immediate;
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

        // SetValues re-resolves these raw strings against the option set on the next solve.
        string selectedJson = null;
        if (reader.TryGetString("SelectedValues", ref selectedJson) && !string.IsNullOrEmpty(selectedJson))
        {
            try
            {
                var array = JArray.Parse(selectedJson);
                var values = array.Select(token => token?.ToString() ?? string.Empty).ToList();
                SetValues(values);
            }
            catch
            {
                // Ignore parse errors
            }
        }

        return base.Read(reader);
    }
}
