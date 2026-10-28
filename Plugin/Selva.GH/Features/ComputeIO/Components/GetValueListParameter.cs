using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
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
public class GetValueListParameter : SelvaContextualParameter<GH_ValueListDataGoo>
{
    private Guid _connectedValueListGuid = Guid.Empty;

    private List<(string Name, string Expression)> _storedItems = new List<(string Name, string Expression)>();

    public GetValueListParameter()
        : base("Get Value List", "Get VL", "Get from ValueList", GH_ParamAccess.item)
    {
    }

    public override string TypeName => "ValueList";
    public override Guid ComponentGuid => new Guid("0CC81276-5DB7-4306-9968-086524EC0C6E");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.GetValueList);

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

    public override bool AutoAssignContextualData(GH_ParameterContext context)
    {
        var names = GetItemTuples().Select(item => item.Name).ToList();
        if (names.Count == 0)
        {
            return true;
        }

        var picked = Utils.PickOptions(ImpliedPrompt, names, AtMost);
        if (picked == null || picked.Count == 0)
        {
            return false;
        }

        AssignContextualData(picked);
        return true;
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
                // Touches UI controls, so it must run on the UI thread.
                try
                {
                    RhinoApp.InvokeOnUiThread(new Action(() => SelectWithoutSolving(vl, index)));
                }
                catch
                {
                    SelectWithoutSolving(vl, index);
                }

                return true;
            }
        }

        return false;
    }

    // GH_ValueList.SelectItem ends in ExpireSolution(true), a solve of its own on top of the one
    // the caller schedules: every dropdown change solved twice.
    private static void SelectWithoutSolving(GH_ValueList vl, int index)
    {
        for (var i = 0; i < vl.ListItems.Count; i++)
        {
            vl.ListItems[i].Selected = i == index;
        }

        vl.ExpireSolution(false);
    }

    // Rhino.Compute builds without the generic contextual handler call these by reflection.
    public void SetValue(string value)
    {
        AssignContextualData(new[] { value });
    }

    public void SetValues(IEnumerable<string> values)
    {
        AssignContextualData(values.ToList());
    }

    // Call before SetValues/SetValue when solving via Rhino Compute, where no GH_ValueList is connected.
    public void LoadItems(Dictionary<string, string> options)
    {
        _storedItems = options.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    protected override IEnumerable<GH_ValueListDataGoo> FromContextual(object value)
    {
        var stringValue = ExtractStringValue(value);
        if (stringValue != null)
        {
            yield return ToGoo(stringValue);
        }
    }

    protected override void CollectFromSources()
    {
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
                if (stringValue != null)
                {
                    converted.Add(ToGoo(stringValue));
                }
            }

            if (converted.Count > 0)
            {
                m_data.AppendRange(converted, path);
            }
        }
    }

    // Maps a name or expression to a known option's expression; an unknown value passes through.
    private GH_ValueListDataGoo ToGoo(string value)
    {
        var items = GetItemTuples();
        var matchIndex = FindMatchingIndex(value);
        var expression = matchIndex >= 0 && matchIndex < items.Count ? items[matchIndex].Expression : value;
        return new GH_ValueListDataGoo(expression, items, matchIndex);
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
        writer.SetBoolean("ListAccess", Access == GH_ParamAccess.list);
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
        // Settings first: SetListAccess below adjusts the AtMost they restore.
        var result = base.Read(reader);

        var listAccess = false;
        if (reader.TryGetBoolean("ListAccess", ref listAccess))
        {
            SetListAccess(listAccess);
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

        return result;
    }
}
