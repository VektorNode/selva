using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.Components.Params;

/// <summary>
///   A contextual parameter that captures value list data including all options and the selected default.
///   The connected GH_ValueList is the single source of truth - data is read directly from it.
/// </summary>
public class GetValueListParameter : GH_Param<GH_ValueListData>, IGH_ContextualParameter
{
  private Guid _connectedValueListGuid = Guid.Empty;
  private DataTree<GH_ValueListData> _contextualDataTree;
  private GH_ValueListData[] _contextual;

  // Stored items for use when ValueList isn't connected (e.g., in Compute)
  private List<(string Name, string Expression)> _storedItems = new();

  public GetValueListParameter()
    : base("Get Value List", "Get VL", "Get from ValueList", "Params", "Util", GH_ParamAccess.item)
  {
  }

  public override string TypeName => "ValueList";
  public override Guid ComponentGuid => new("0CC81276-5DB7-4306-9968-086524EC0C6E");

  // IGH_ContextualParameter properties
  public string Prompt { get; set; } = string.Empty;
  public int AtLeast { get; set; } = 1;
  public int AtMost { get; set; } = 1;
  public bool TreeAccess { get; set; }
  public bool Immediate { get; set; } = true;

  /// <summary>
  ///   Gets the connected ValueList (single source of truth)
  /// </summary>
  private GH_ValueList ConnectedValueList
  {
    get
    {
      // First try the cached GUID
      if (_connectedValueListGuid != Guid.Empty)
      {
        var cached = OnPingDocument()?.FindObject(_connectedValueListGuid, false) as GH_ValueList;
        if (cached != null) return cached;
      }

      // Fallback: check Sources directly (in case GUID wasn't set yet)
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

  /// <summary>
  ///   All available items - always read directly from connected ValueList
  /// </summary>
  public IReadOnlyList<GH_ValueListItem> ListItems => ConnectedValueList?.ListItems ?? (IReadOnlyList<GH_ValueListItem>)Array.Empty<GH_ValueListItem>();

  /// <summary>
  ///   Currently selected items - always read directly from connected ValueList
  /// </summary>
  public IReadOnlyList<GH_ValueListItem> SelectedItems => ConnectedValueList?.SelectedItems ?? (IReadOnlyList<GH_ValueListItem>)Array.Empty<GH_ValueListItem>();

  /// <summary>
  ///   Index of the first selected item
  /// </summary>
  public int SelectedIndex
  {
    get
    {
      var vl = ConnectedValueList;
      if (vl == null || vl.SelectedItems.Count == 0) return -1;
      return vl.ListItems.IndexOf(vl.SelectedItems[0]);
    }
  }

  /// <summary>
  ///   Values dictionary for Rhino Compute serialization
  /// </summary>
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

  /// <summary>
  ///   Gets the default (selected) value
  /// </summary>
  public string GetDefaultValue()
  {
    var selected = SelectedItems;
    return selected.Count > 0 ? selected[0].Expression : null;
  }

  /// <summary>
  ///   Selects an item by its name. Returns true if found and selected.
  ///   This is the simplest way to update the selection from external sources (WebSocket, etc.)
  /// </summary>
  public bool SelectItemByName(string name)
  {
    var vl = ConnectedValueList;
    if (vl == null) return false;

    for (var i = 0; i < vl.ListItems.Count; i++)
    {
      if (vl.ListItems[i].Name == name)
      {
        vl.SelectItem(i);
        ExpireSolution(false);
        return true;
      }
    }
    return false;
  }

  public IEnumerable<object> ContextualData
  {
    get
    {
      var items = GetItemTuples();
      foreach (var selected in SelectedItems)
      {
        var index = ListItems.ToList().IndexOf(selected);
        yield return new GH_ValueListData(selected.Expression, items, index);
      }
    }
  }

  public void AssignContextualData(IEnumerable data)
  {
    var list = new List<GH_ValueListData>();
    var items = GetItemTuples();
    var currentSelectedIndex = SelectedIndex;

    foreach (var item in data)
    {
      var stringValue = ExtractStringValue(item);
      if (stringValue == null) continue;

      // Find matching index
      var matchIndex = FindMatchingIndex(stringValue);
      var selectedIndex = matchIndex >= 0 ? matchIndex : currentSelectedIndex;

      list.Add(new GH_ValueListData(stringValue, items, selectedIndex));
    }

    _contextual = list.ToArray();

    // Also update the ValueList selection if connected
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

  public void ClearContextualData()
  {
    _contextual = null;
    _contextualDataTree = null;
  }

  /// <summary>
  ///   Assigns contextual data as a tree structure for multi-branch data.
  /// </summary>
  public void AssignContextualDataTree(DataTree<GH_ValueListData> data)
  {
    _contextualDataTree = data;
    ExpireSolution(false);
  }

  /// <summary>
  ///   Sets a single string value directly - for use from Rhino Compute via reflection.
  ///   Call this instead of AssignContextualData when you only have strings.
  /// </summary>
  public void SetValue(string value)
  {
    var items = GetItemTuples();
    var matchIndex = FindMatchingIndex(value);
    _contextual = new[] { new GH_ValueListData(value, items, matchIndex) };
    ExpireSolution(false);
  }

  /// <summary>
  ///   Sets multiple string values directly - for use from Rhino Compute via reflection.
  ///   Call this instead of AssignContextualData when you only have strings.
  /// </summary>
  public void SetValues(IEnumerable<string> values)
  {
    var items = GetItemTuples();
    var list = new List<GH_ValueListData>();

    foreach (var value in values)
    {
      var matchIndex = FindMatchingIndex(value);
      list.Add(new GH_ValueListData(value, items, matchIndex));
    }

    _contextual = list.ToArray();
    ExpireSolution(false);
  }

  /// <summary>
  ///   Returns contextual data formatted for JSON serialization
  /// </summary>
  public JObject GetContextualJson()
  {
    return new JObject
    {
      { "description", Description ?? "" },
      { "name", Name },
      { "nickname", NickName },
      { "treeAccess", Access == GH_ParamAccess.tree },
      { "paramType", TypeName },
      { "default", GetDefaultValue() },
      { "values", JObject.FromObject(Values) }
    };
  }

  protected override void CollectVolatileData_FromSources()
  {
    // Handle contextual array if present (from AssignContextualData)
    if (_contextual != null)
    {
      m_data.Clear();
      m_data.AppendRange(_contextual, new GH_Path(0));
      return;
    }

    // Handle contextual data tree if present
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

    if (Sources == null || Sources.Count == 0) return;

    foreach (var source in Sources)
    {
      if (source is GH_ValueList vl)
      {
        // Track the connected ValueList
        if (_connectedValueListGuid != vl.InstanceGuid)
        {
          _connectedValueListGuid = vl.InstanceGuid;
        }

        // Build data directly from the ValueList's current state
        var items = GetItemTuples();
        var selectedData = new List<GH_ValueListData>();

        foreach (var selectedItem in vl.SelectedItems)
        {
          var index = vl.ListItems.IndexOf(selectedItem);
          selectedData.Add(new GH_ValueListData(selectedItem.Expression, items, index));
        }

        if (selectedData.Count > 0)
        {
          m_data.AppendRange(selectedData, new GH_Path(0));
        }
      }
      else
      {
        // Handle non-ValueList sources by matching against our items
        ProcessGenericSource(source);
      }
    }
  }

  private void ProcessGenericSource(IGH_Param source)
  {
    var sourceData = source.VolatileData;
    if (sourceData == null || sourceData.PathCount == 0) return;

    var items = GetItemTuples();

    foreach (var path in sourceData.Paths)
    {
      var branch = sourceData.get_Branch(path);
      if (branch == null) continue;

      var converted = new List<GH_ValueListData>();
      foreach (var item in branch)
      {
        var stringValue = ExtractStringValue(item);
        if (stringValue == null) continue;

        var matchIndex = FindMatchingIndex(stringValue);
        converted.Add(new GH_ValueListData(stringValue, items, matchIndex));
      }

      if (converted.Count > 0)
      {
        m_data.AppendRange(converted, path);
      }
    }
  }

  private List<(string Name, string Expression)> GetItemTuples()
  {
    // Try connected ValueList first
    var vl = ConnectedValueList;
    if (vl != null && vl.ListItems.Count > 0)
    {
      // Update stored items while we have access
      _storedItems = vl.ListItems.Select(x => (x.Name, x.Expression)).ToList();
      return _storedItems;
    }

    // Fall back to stored items (for Compute scenarios)
    return _storedItems;
  }

  private int FindMatchingIndex(string value)
  {
    // Try connected ValueList first
    var items = ListItems;
    for (var i = 0; i < items.Count; i++)
    {
      if (items[i].Expression == value) return i;
    }

    // Fall back to stored items
    for (var i = 0; i < _storedItems.Count; i++)
    {
      if (_storedItems[i].Expression == value) return i;
    }

    return -1;
  }

  private static string ExtractStringValue(object item)
  {
    return item switch
    {
      null => null,
      GH_ValueListData vld => vld.Value,
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
    writer.SetBoolean("Immediate", Immediate);
    writer.SetString("ConnectedValueListGuid", _connectedValueListGuid.ToString());

    // Store items for Compute scenarios - refresh from ValueList if connected
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
    if (reader.TryGetInt32("AtLeast", ref atLeast)) AtLeast = atLeast;

    var atMost = 1;
    if (reader.TryGetInt32("AtMost", ref atMost)) AtMost = atMost;

    var treeAccess = false;
    if (reader.TryGetBoolean("TreeAccess", ref treeAccess)) TreeAccess = treeAccess;

    var immediate = true;
    if (reader.TryGetBoolean("Immediate", ref immediate)) Immediate = immediate;

    string guidStr = null;
    if (reader.TryGetString("ConnectedValueListGuid", ref guidStr) &&
        Guid.TryParse(guidStr, out var guid))
    {
      _connectedValueListGuid = guid;
    }

    // Load stored items for Compute scenarios
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
