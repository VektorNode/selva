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

    // The currently-known options (name -> expression). Populated by the UI on apply (LoadItems) and
    // persisted so a saved document round-trips its last-known options for Rhino.Compute.
    private List<(string Name, string Expression)> _storedItems = new List<(string Name, string Expression)>();

    public GetDynamicValueListParameter()
        : base("Get Dynamic Value List", "Get DynVL", "Get a value from a runtime-computed value list", "Params",
            "Util", GH_ParamAccess.item)
    {
    }


    public override GH_Exposure Exposure => GH_Exposure.quinary;

    // Reuse "ValueList" so Rhino.Compute's existing ValueList input case handles this param with no
    // fork change — the input side (passing the selected string downstream) is identical to the
    // static value list. The dynamic vs. static distinction is carried by the schema/class name
    // (ResolveParameterTypeName keys on the CLR class name, not TypeName), not by TypeName.
    public override string TypeName => "ValueList";
    public override Guid ComponentGuid => new Guid("9F2C4B7E-3A8D-4C1F-B6E5-2D7A9C0E1F34");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.GetValueList);

    public bool TreeAccess { get; set; }

    /// <summary>
    ///     All available items (name -> expression). Sourced from the last-applied options.
    /// </summary>
    [JsonProperty("values")]
    public Dictionary<string, string> Values
    {
        get
        {
            var dict = new Dictionary<string, string>();
            foreach (var item in _storedItems)
            {
                dict[item.Name] = item.Expression;
            }

            return dict;
        }
    }

    // IGH_ContextualParameter properties
    public string Prompt { get; set; } = string.Empty;
    public int AtLeast { get; set; } = 1;
    public int AtMost { get; set; } = 1;
    public bool Immediate { get; set; } = true;

    /// <summary>
    ///     Enable list/multi-select mode (driven by the schema's `displayAs: 'checklist'`).
    /// </summary>
    public void SetListAccess(bool listAccess)
    {
        Access = listAccess ? GH_ParamAccess.list : GH_ParamAccess.item;
        if (listAccess && AtMost <= 1)
        {
            AtMost = int.MaxValue;
        }
        else if (!listAccess && AtMost == int.MaxValue)
        {
            AtMost = 1;
        }
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

    /// <summary>
    ///     Assigns contextual data as a tree - called by Rhino.Compute via reflection.
    /// </summary>
    public void AssignContextualDataTree(DataTree<GH_ValueListDataGoo> data)
    {
        _contextualDataTree = data;
        ExpireSolution(false);
    }

    /// <summary>
    ///     Sets a single string value directly - for use from Rhino.Compute via reflection.
    /// </summary>
    public void SetValue(string value)
    {
        SetValues(new[] { value });
    }

    /// <summary>
    ///     Sets one or more string values directly - for use from Rhino.Compute via reflection.
    /// </summary>
    public void SetValues(IEnumerable<string> values)
    {
        _contextual = values.Select(ToGoo).ToArray();
        ExpireSolution(false);
    }

    /// <summary>
    ///     Wraps a selected value in a goo, mapping it to a known option's expression when one matches,
    ///     otherwise passing the value through verbatim (the option set is recomputed each solve).
    /// </summary>
    private GH_ValueListDataGoo ToGoo(string value)
    {
        var matchIndex = FindMatchingIndex(value);
        var expression = matchIndex >= 0 && matchIndex < _storedItems.Count
            ? _storedItems[matchIndex].Expression
            : value;
        return new GH_ValueListDataGoo(expression, _storedItems, matchIndex);
    }

    /// <summary>
    ///     Records the selected value so it flows downstream on the next solve.
    ///     Unlike the static value list, the options here are computed each solve and there is no
    ///     authoritative list to validate against — any non-empty value is accepted as-is (matched
    ///     to a known option's expression when one exists, otherwise passed through verbatim).
    ///     Returns true whenever a value was recorded.
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
    ///     was recorded. See <see cref="SelectItemByName" /> for why no matching is required.
    /// </summary>
    public bool SelectItemsByName(IEnumerable<string> values)
    {
        if (values == null)
        {
            return false;
        }

        var valueList = values.Where(v => !string.IsNullOrEmpty(v)).ToList();
        if (valueList.Count == 0)
        {
            return false;
        }

        SetValues(valueList);
        return true;
    }

    /// <summary>
    ///     Populates the known options from a name -> expression dictionary. Called by the web UI
    ///     before applying a selection so the selection can be matched against current options.
    /// </summary>
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
    }

    /// <summary>
    ///     Gets the default (currently selected) value, or the first known option, or empty.
    /// </summary>
    public string GetDefaultValue()
    {
        if (_contextual != null && _contextual.Length > 0)
        {
            return _contextual[0].Value;
        }

        return _storedItems.Count > 0 ? _storedItems[0].Expression : string.Empty;
    }

    /// <summary>
    ///     Returns contextual JSON for web UI schema discovery.
    /// </summary>
    public JObject GetContextualJson()
    {
        return new JObject
        {
            { "description", Description ?? "" },
            { "name", Name },
            { "nickname", NickName },
            { "treeAccess", Access == GH_ParamAccess.tree },
            { "paramType", "dynamicValueList" },
            { "default", GetDefaultValue() },
            { "values", JObject.FromObject(Values) }
        };
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

    /// <summary>
    ///     Populate volatile data. Precedence:
    ///     1. A UI selection (contextual data / tree).
    ///     2. A wired initial value list ("key" = value pairs) → emit its default (first) item.
    ///     3. Nothing set → emit a single empty string so the output is never "no data";
    ///        it is replaced once a computed value arrives from the UI.
    /// </summary>
    private void EmitData()
    {
        m_data.Clear();

        if (_contextual != null)
        {
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

        var initialOptions = ReadInitialOptionsFromSources();
        if (initialOptions.Count > 0)
        {
            _storedItems = initialOptions;
            var first = _storedItems[0];
            m_data.Append(new GH_ValueListDataGoo(first.Expression, _storedItems, 0), new GH_Path(0));
            return;
        }

        // allowEmpty keeps the empty goo valid so downstream doesn't drop it.
        m_data.Append(new GH_ValueListDataGoo(string.Empty, _storedItems, -1, allowEmpty: true), new GH_Path(0));
    }

    /// <summary>
    ///     Reads "key" = value pair strings from wired sources into an ordered (Name, Expression) list.
    ///     This is the GH-side initial value list — the author wires a Panel of pairs to seed options
    ///     before the web UI has computed any.
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

    private int FindMatchingIndex(string value)
    {
        for (var i = 0; i < _storedItems.Count; i++)
        {
            if (string.Equals(_storedItems[i].Expression, value, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(_storedItems[i].Name, value, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
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

        return base.Read(reader);
    }
}
