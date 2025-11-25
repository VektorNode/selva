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

namespace ComputeBuilder.Components.Params;

/// <summary>
///   A contextual parameter that captures value list data including all options and the selected default.
///   The connected GH_ValueList is the single source of truth - data is read directly from it.
/// </summary>
public class GetValueListParameter : GH_Param<GH_ValueListData>, IGH_ContextualParameter
{
  private Guid _connectedValueListGuid = Guid.Empty;

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
    var vl = ConnectedValueList;
    if (vl == null) return;

    foreach (var item in data)
    {
      var stringValue = ExtractStringValue(item);
      if (stringValue == null) continue;

      // Find and select the matching item by expression
      for (var i = 0; i < vl.ListItems.Count; i++)
      {
        if (vl.ListItems[i].Expression == stringValue)
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
    // Nothing to clear - ValueList is the source of truth
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
    return ListItems.Select(x => (x.Name, x.Expression)).ToList();
  }

  private int FindMatchingIndex(string value)
  {
    var items = ListItems;
    for (var i = 0; i < items.Count; i++)
    {
      if (items[i].Expression == value) return i;
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

    return base.Read(reader);
  }
}
