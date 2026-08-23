using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino;
using Selva.GH.Features.ComputeIO.Goos;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

// Captures value list data (options + selected default) as a contextual parameter. The connected
// GH_ValueList is the single source of truth — data is read directly from it, never cached.
public class GetValueListParameter : GH_Param<GH_ValueListDataGoo>, IGH_ContextualParameter
{
    private Guid _connectedValueListGuid = Guid.Empty;
    private GH_ValueListDataGoo[] _contextual;
    private DataTree<GH_ValueListDataGoo> _contextualDataTree;

    private List<(string Name, string Expression)> _storedItems = new List<(string Name, string Expression)>();

    public GetValueListParameter()
        : base("Get Value List", "Get VL", "Get from ValueList", "Params", "Util", GH_ParamAccess.item)
    {
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;

    public override string TypeName => "ValueList";
    public override Guid ComponentGuid => new Guid("0CC81276-5DB7-4306-9968-086524EC0C6E");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.GetValueList);

    public bool TreeAccess { get; set; }

    private GH_ValueList ConnectedValueList
    {
        get
        {
            if (_connectedValueListGuid != Guid.Empty)
            {
                var cached = OnPingDocument()?.FindObject(_connectedValueListGuid, false) as GH_ValueList;
                if (cached != null)
                {
                    return cached;
                }
            }

            if (Sources != null)
            {
                foreach (var source in Sources)
                {
                    if (source is GH_ValueList vl)
                    {
                        _connectedValueListGuid = vl.InstanceGuid;
                        return vl;
                    }
                }
            }

            return null;
        }
    }

    public IReadOnlyList<GH_ValueListItem> ListItems => ConnectedValueList?.ListItems ??
                                                        (IReadOnlyList<GH_ValueListItem>)Array
                                                            .Empty<GH_ValueListItem>();

    public IReadOnlyList<GH_ValueListItem> SelectedItems => ConnectedValueList?.SelectedItems ??
                                                            (IReadOnlyList<GH_ValueListItem>)
                                                            Array.Empty<GH_ValueListItem>();

    public int SelectedIndex
    {
        get
        {
            var vl = ConnectedValueList;
            if (vl == null || vl.SelectedItems.Count == 0)
            {
                return -1;
            }

            return vl.ListItems.IndexOf(vl.SelectedItems[0]);
        }
    }

    [JsonProperty("values")]
    public Dictionary<string, string> Values
    {
        get
        {
            var dict = new Dictionary<string, string>();
            foreach (var item in ListItems)
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

    // AtMost is raised to allow multiple selections in list mode, restored to 1 when switching back.
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
            var items = GetItemTuples();
            foreach (var selected in SelectedItems)
            {
                var index = ListItems.ToList().IndexOf(selected);
                yield return new GH_ValueListDataGoo(selected.Expression, items, index);
            }
        }
    }

    public void AssignContextualData(IEnumerable data)
    {
        var list = new List<GH_ValueListDataGoo>();
        var items = GetItemTuples();
        var currentSelectedIndex = SelectedIndex;

        foreach (var item in data)
        {
            var stringValue = ExtractStringValue(item);
            if (stringValue == null)
            {
                continue;
            }

            var matchIndex = FindMatchingIndex(stringValue);
            var selectedIndex = matchIndex >= 0 ? matchIndex : currentSelectedIndex;

            var expressionValue = matchIndex >= 0 && matchIndex < items.Count
                ? items[matchIndex].Expression
                : stringValue;

            list.Add(new GH_ValueListDataGoo(expressionValue, items, selectedIndex));
        }

        _contextual = list.ToArray();

        var vl = ConnectedValueList;
        if (vl != null && _contextual.Length > 0)
        {
            var firstValue = _contextual[0].Value;
            for (var i = 0; i < vl.ListItems.Count; i++)
            {
                if (vl.ListItems[i].Expression == firstValue)
                {
                    vl.SelectItem(i);
                    break;
                }
            }
        }

        ExpireSolution(false);
    }

    public bool AutoAssignContextualData(GH_ParameterContext context)
    {
        return ConnectedValueList != null;
    }


    public string GetDefaultValue()
    {
        var vl = ConnectedValueList;
        if (vl != null && vl.SelectedItems.Count > 0)
        {
            return vl.SelectedItems[0].Expression;
        }

        var items = GetItemTuples();
        if (items.Count > 0)
        {
            return items[0].Expression;
        }

        return string.Empty;
    }

    // Checklist (multi-select) mode: switches the ValueList into CheckList so all matched
    // items can be co-selected at once, then expires. Returns true if anything matched.
    public bool SelectItemsByName(IEnumerable<string> values)
    {
        var vl = ConnectedValueList;
        if (vl == null || values == null)
        {
            return false;
        }

        var requested = new HashSet<string>(values.Where(v => v != null), StringComparer.OrdinalIgnoreCase);
        if (requested.Count == 0)
        {
            return false;
        }

        Action apply = () =>
        {
            vl.ListMode = GH_ValueListMode.CheckList;

            var matched = false;
            for (var i = 0; i < vl.ListItems.Count; i++)
            {
                var item = vl.ListItems[i];
                var shouldSelect = requested.Contains(item.Name) || requested.Contains(item.Expression);
                item.Selected = shouldSelect;
                if (shouldSelect)
                {
                    matched = true;
                }
            }

            if (matched)
            {
                vl.ExpireSolution(false);
            }
        };

        try
        {
            RhinoApp.InvokeOnUiThread(new Action(apply));
        }
        catch
        {
            apply();
        }

        return vl.ListItems.Any(li =>
            requested.Contains(li.Name) || requested.Contains(li.Expression));
    }

    // Matches by name (e.g. "Cylinder") or by expression (e.g. "1", for Rhino.Compute
    // compatibility). Does not call ExpireSolution — the caller triggers the solution.
    public bool SelectItemByName(string value)
    {
        var vl = ConnectedValueList;
        if (vl == null)
        {
            return false;
        }

        for (var i = 0; i < vl.ListItems.Count; i++)
        {
            if (vl.ListItems[i].Name == value || vl.ListItems[i].Expression == value)
            {
                var index = i;
                // SelectItem touches UI controls, so it must run on the UI thread.
                try
                {
                    RhinoApp.InvokeOnUiThread(new Action(() => vl.SelectItem(index)));
                }
                catch
                {
                    vl.SelectItem(index);
                }

                return true;
            }
        }

        return false;
    }

    public void ClearContextualData()
    {
        _contextual = null;
        _contextualDataTree = null;
    }

    public void AssignContextualDataTree(DataTree<GH_ValueListDataGoo> data)
    {
        _contextualDataTree = data;
        ExpireSolution(false);
    }

    // Called from Rhino Compute via reflection when only a plain string is available
    // (AssignContextualData needs richer objects).
    public void SetValue(string value)
    {
        var items = GetItemTuples();
        var matchIndex = FindMatchingIndex(value);
        var expressionValue = matchIndex >= 0 && matchIndex < items.Count
            ? items[matchIndex].Expression
            : value;
        _contextual = new[] { new GH_ValueListDataGoo(expressionValue, items, matchIndex) };
        ExpireSolution(false);
    }

    // Same as SetValue, for multiple values.
    public void SetValues(IEnumerable<string> values)
    {
        var items = GetItemTuples();
        var list = new List<GH_ValueListDataGoo>();

        foreach (var value in values)
        {
            var matchIndex = FindMatchingIndex(value);
            var expressionValue = matchIndex >= 0 && matchIndex < items.Count
                ? items[matchIndex].Expression
                : value;
            list.Add(new GH_ValueListDataGoo(expressionValue, items, matchIndex));
        }

        _contextual = list.ToArray();
        ExpireSolution(false);
    }

    // Call before SetValues/SetValue when solving via Rhino Compute, where no GH_ValueList is connected.
    public void LoadItems(Dictionary<string, string> options)
    {
        _storedItems = options.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    protected override void CollectVolatileData_FromSources()
    {
        if (_contextual != null)
        {
            m_data.Clear();
            m_data.AppendRange(_contextual, new GH_Path(0));
            return;
        }

        if (_contextualDataTree != null)
        {
            m_data.Clear();
            for (var i = 0; i < _contextualDataTree.BranchCount; i++)
            {
                m_data.AppendRange(_contextualDataTree.Branches[i], _contextualDataTree.Paths[i]);
            }

            return;
        }

        m_data.Clear();

        if (Sources == null || Sources.Count == 0)
        {
            return;
        }

        foreach (var source in Sources)
        {
            if (source is GH_ValueList vl)
            {
                if (_connectedValueListGuid != vl.InstanceGuid)
                {
                    _connectedValueListGuid = vl.InstanceGuid;
                }

                var items = GetItemTuples();
                var selectedData = new List<GH_ValueListDataGoo>();

                foreach (var selectedItem in vl.SelectedItems)
                {
                    var index = vl.ListItems.IndexOf(selectedItem);
                    selectedData.Add(new GH_ValueListDataGoo(selectedItem.Expression, items, index));
                }

                if (selectedData.Count > 0)
                {
                    m_data.AppendRange(selectedData, new GH_Path(0));
                }
            }
            else
            {
                ProcessGenericSource(source);
            }
        }
    }

    private void ProcessGenericSource(IGH_Param source)
    {
        var sourceData = source.VolatileData;
        if (sourceData == null || sourceData.PathCount == 0)
        {
            return;
        }

        var items = GetItemTuples();

        foreach (var path in sourceData.Paths)
        {
            var branch = sourceData.get_Branch(path);
            if (branch == null)
            {
                continue;
            }

            var converted = new List<GH_ValueListDataGoo>();
            foreach (var item in branch)
            {
                var stringValue = ExtractStringValue(item);
                if (stringValue == null)
                {
                    continue;
                }

                var matchIndex = FindMatchingIndex(stringValue);
                var expressionValue = matchIndex >= 0 && matchIndex < items.Count
                    ? items[matchIndex].Expression
                    : stringValue;
                converted.Add(new GH_ValueListDataGoo(expressionValue, items, matchIndex));
            }

            if (converted.Count > 0)
            {
                m_data.AppendRange(converted, path);
            }
        }
    }

    private List<(string Name, string Expression)> GetItemTuples()
    {
        var vl = ConnectedValueList;
        if (vl != null && vl.ListItems.Count > 0)
        {
            _storedItems = vl.ListItems.Select(x => (x.Name, x.Expression)).ToList();
        }

        return _storedItems;
    }

    private int FindMatchingIndex(string value)
    {
        // GetItemTuples refreshes _storedItems from the live ValueList as a side effect.
        var items = GetItemTuples();
        for (var i = 0; i < items.Count; i++)
        {
            if (string.Equals(items[i].Expression, value, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(items[i].Name, value, StringComparison.OrdinalIgnoreCase))
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
        writer.SetString("ConnectedValueListGuid", _connectedValueListGuid.ToString());

        var items = GetItemTuples();
        var itemsJson = new JArray();
        foreach (var item in items)
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

        string guidStr = null;
        if (reader.TryGetString("ConnectedValueListGuid", ref guidStr) &&
            Guid.TryParse(guidStr, out var guid))
        {
            _connectedValueListGuid = guid;
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
            }
        }

        return base.Read(reader);
    }
}
