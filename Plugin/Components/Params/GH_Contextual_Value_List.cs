using System;
using System.Collections;
using System.Collections.Generic;
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
///   Rhino Compute Integration:
///   To get the full value list data (including 'values' object and string 'default') in Compute output,
///   you need to modify the InputGroup class in your Compute server application.
///   Add these methods to InputGroup:
///   public string GetDefault()
///   {
///   if (Param is IGH_ContextualParameter contextualParam)
///   {
///   var method = contextualParam.GetType().GetMethod("GetDefaultValue");
///   if (method != null)
///   {
///   var result = method.Invoke(contextualParam, null);
///   if (result != null)
///   return result.ToString();
///   }
///   }
///   // Fall back to original behavior
///   return SerializeDataTree(Param.VolatileData, Param.Name);
///   }
///   public object GetValues()
///   {
///   if (Param is IGH_ContextualParameter contextualParam)
///   {
///   var prop = contextualParam.GetType().GetProperty("Values");
///   if (prop != null)
///   return prop.GetValue(contextualParam, null);
///   }
///   return null;
///   }
///   Then in your JSON serialization code, add the values field:
///   var values = inputGroup.GetValues();
///   if (values != null)
///   jsonObject["values"] = values;
/// </summary>
public class GetValueListParameter : GH_Param<GH_ValueListData>,
  IGH_ContextualParameter
{
  private GH_ValueList _cachedValueList;
  private Guid _connectedValueListGuid = Guid.Empty;
  private GH_ValueListData[] _contextual;
  private DataTree<GH_ValueListData> _contextualDataTree;


  public GetValueListParameter()
    : base("Get Value List", "Get VL", "Get from ValueList", "Params", "Util", GH_ParamAccess.item)
  {
  }


  public override string TypeName => "ValueList";

  public override Guid ComponentGuid => new("0CC81276-5DB7-4306-9968-086524EC0C6E");
  public bool TreeAccess { get; set; }

  /// <summary>
  ///   Values object for Rhino Compute serialization - returns all value list items.
  ///   NOTE: To make this appear in Rhino Compute output, you need to modify the InputGroup class
  ///   in your Compute server to add a GetValues() method that reads this property via reflection.
  ///   See the GetMinimum() and GetMaximum() methods in InputGroup for the pattern.
  ///   Alternatively, this property will be serialized if you use JSON.NET to serialize the parameter directly.
  /// </summary>
  [JsonProperty("values")]
  public Dictionary<string, string> Values
  {
    get
    {
      if (StoredListItems.Count == 0 && _connectedValueListGuid != Guid.Empty)
      {
        StoreValueListData();
      }

      var valuesDict = new Dictionary<string, string>();
      foreach (var item in StoredListItems)
      {
        valuesDict[item.Name] = item.Expression;
      }

      return valuesDict;
    }
  }

  /// <summary>
  ///   Gets the stored ValueList items
  /// </summary>
  public List<GH_ValueListItem> StoredListItems { get; } = new();

  /// <summary>
  ///   Gets or sets the default selected index
  /// </summary>
  public int DefaultSelectedIndex { get; set; } = -1;

  public string Prompt { get; set; } = string.Empty;
  public int AtLeast { get; set; } = 1;
  public int AtMost { get; set; } = 1;
  public bool Immediate { get; set; } = true;

  public IEnumerable<object> ContextualData
  {
    get
    {
      if (_contextual != null)
      {
        foreach (var item in _contextual)
        {
          yield return item;
        }
      }
    }
  }

  public void AssignContextualData(IEnumerable data)
  {
    var list = new List<GH_ValueListData>();

    // Always refresh stored data when we're connected to a ValueList
    if (_connectedValueListGuid != Guid.Empty)
    {
      StoreValueListData();
    }

    var currentSelectedIndex = DefaultSelectedIndex;
    var vl = GetConnectedValueList();
    if (vl != null && vl.SelectedItems.Count > 0)
    {
      currentSelectedIndex = vl.ListItems.IndexOf(vl.SelectedItems[0]);
    }

    var itemsTuples = StoredListItems.ConvertAll(x => (x.Name, x.Expression));

    foreach (var item in data)
    {
      if (item is GH_ValueListData vld)
      {
        if (vld.Items.Count == 0 && itemsTuples.Count > 0)
        {
          list.Add(new GH_ValueListData(vld.Value, itemsTuples, vld.SelectedIndex));
        }
        else
        {
          list.Add(vld);
        }
      }
      else
      {
        string stringValue;

        if (item is GH_String ghString)
        {
          stringValue = ghString.Value;
        }
        else if (item is IGH_Goo goo)
        {
          if (goo.CastTo(out string castValue))
          {
            stringValue = castValue;
          }
          else
          {
            stringValue = goo.ToString();
          }
        }
        else if (item is string str)
        {
          stringValue = str;
        }
        else
        {
          stringValue = item?.ToString() ?? "";
        }

        var matchingIndex = -1;
        for (var i = 0; i < StoredListItems.Count; i++)
        {
          if (StoredListItems[i].Expression == stringValue)
          {
            matchingIndex = i;
            break;
          }
        }

        // Use matching index if found, otherwise use current selection
        var selectedIndex = matchingIndex >= 0 ? matchingIndex : currentSelectedIndex;

        list.Add(new GH_ValueListData(stringValue, itemsTuples, selectedIndex));
      }
    }

    _contextual = list.ToArray();
    ExpireSolution(false);
  }

  public bool AutoAssignContextualData(GH_ParameterContext context)
  {
    var vl = GetConnectedValueList();
    if (vl == null)
    {
      return false;
    }

    // Store the ValueList data
    StoreValueListData();

    var items = new List<GH_String>();
    for (var i = 0; i < vl.ListItems.Count; i++)
    {
      items.Add(new GH_String(vl.ListItems[i].Expression));
    }

    AssignContextualData(items);
    return true;
  }

  /// <summary>
  ///   Returns contextual data formatted for JSON serialization
  /// </summary>
  public JObject GetContextualJson()
  {
    var json = new JObject
    {
      { "description", Description ?? "" },
      { "name", Name },
      { "nickname", NickName },
      { "treeAccess", Access == GH_ParamAccess.tree },
      { "groupName", "" }, // Could be extended if needed
      { "paramType", TypeName }
    };

    // Get the default value from the currently selected item
    if (DefaultSelectedIndex >= 0 && DefaultSelectedIndex < StoredListItems.Count)
    {
      json["default"] = StoredListItems[DefaultSelectedIndex].Expression;
    }
    else if (_contextual != null && _contextual.Length > 0)
    {
      json["default"] = _contextual[0].GetDefaultValue();
    }
    else
    {
      json["default"] = null;
    }

    var valuesObj = new JObject();
    foreach (var item in StoredListItems)
    {
      valuesObj[item.Name] = item.Expression;
    }

    json["values"] = valuesObj;

    return json;
  }

  /// <summary>
  ///   Gets the default value as a single item (what would be selected on compute).
  ///   NOTE: To make Compute use this instead of the data tree for the "default" field,
  ///   modify the InputGroup.GetDefault() method in your Compute server to check if the
  ///   parameter has a GetDefaultValue() method and use that instead of SerializeDataTree().
  /// </summary>
  public string GetDefaultValue()
  {
    // Ensure we have stored data from the value list
    if (StoredListItems.Count == 0 && _connectedValueListGuid != Guid.Empty)
    {
      StoreValueListData();
    }

    if (DefaultSelectedIndex >= 0 && DefaultSelectedIndex < StoredListItems.Count)
    {
      return StoredListItems[DefaultSelectedIndex].Expression;
    }

    // Fallback: return the current value if available
    if (m_data != null && m_data.DataCount > 0)
    {
      var firstItem = m_data.get_FirstItem(true);
      if (firstItem != null)
      {
        return firstItem.Value;
      }
    }

    return null;
  }

  public GH_ValueList GetConnectedValueList()
  {
    if (_connectedValueListGuid == Guid.Empty)
    {
      return null;
    }

    // Return cached value if available
    if (_cachedValueList != null && _cachedValueList.InstanceGuid == _connectedValueListGuid)
    {
      return _cachedValueList;
    }

    var doc = OnPingDocument();
    _cachedValueList = doc?.FindObject(_connectedValueListGuid, false) as GH_ValueList;
    return _cachedValueList;
  }

  /// <summary>
  ///   Stores all items from the connected ValueList
  /// </summary>
  public void StoreValueListData()
  {
    var vl = GetConnectedValueList();
    if (vl == null)
    {
      return;
    }

    StoredListItems.Clear();
    for (var i = 0; i < vl.ListItems.Count; i++)
    {
      StoredListItems.Add(vl.ListItems[i]);
    }

    // Store the currently selected index as default
    var selectedIndices = new List<int>();
    foreach (var item in vl.SelectedItems)
    {
      DefaultSelectedIndex = vl.ListItems.IndexOf(item);
      selectedIndices.Add(DefaultSelectedIndex);
    }
  }


  public void AssignContextualDataTree(DataTree<GH_ValueListData> data)
  {
    _contextualDataTree = data;
    ExpireSolution(false);
  }

  public void ClearContextualData()
  {
    _contextual = null;
    _contextualDataTree = null;
  }

  public void ConnectToValueList(GH_ValueList valueList)
  {
    if (valueList != null)
    {
      _connectedValueListGuid = valueList.InstanceGuid;
      _cachedValueList = valueList;
      StoreValueListData();
      OnPingDocument()?.Modified();
    }
  }

  protected override void CollectVolatileData_FromSources()
  {
    if (_contextual != null)
    {
      var structure = new GH_Structure<GH_ValueListData>();
      structure.AppendRange(_contextual, new GH_Path(0));
      m_data = structure;
      return;
    }

    if (_contextualDataTree != null)
    {
      var structure = new GH_Structure<GH_ValueListData>();
      for (var i = 0; i < _contextualDataTree.BranchCount; i++)
      {
        structure.AppendRange(_contextualDataTree.Branches[i], _contextualDataTree.Paths[i]);
      }

      m_data = structure;
      return;
    }

    m_data.Clear();

    if (Sources == null || Sources.Count == 0)
    {
      return;
    }

    foreach (var source in Sources)
    {
      if (source == null)
      {
        continue;
      }

      if (source is GH_ValueList vl)
      {
        if (_connectedValueListGuid == Guid.Empty || _connectedValueListGuid != vl.InstanceGuid)
        {
          ConnectToValueList(vl);
        }
        else if (StoredListItems.Count == 0)
        {
          StoreValueListData();
        }

        var selectedItems = new List<GH_ValueListData>();
        var itemsTuples = StoredListItems.ConvertAll(x => (x.Name, x.Expression));

        foreach (var selectedItem in vl.SelectedItems)
        {
          var index = vl.ListItems.IndexOf(selectedItem);
          selectedItems.Add(new GH_ValueListData(selectedItem.Expression, itemsTuples, index));
        }

        if (selectedItems.Count == 0 && DefaultSelectedIndex >= 0 &&
            DefaultSelectedIndex < StoredListItems.Count)
        {
          selectedItems.Add(new GH_ValueListData(
            StoredListItems[DefaultSelectedIndex].Expression,
            itemsTuples,
            DefaultSelectedIndex));
        }

        m_data.AppendRange(selectedItems, new GH_Path(0));
        continue;
      }

      var sourceData = source.VolatileData;
      if (sourceData == null || sourceData.PathCount == 0)
      {
        continue;
      }

      foreach (var path in sourceData.Paths)
      {
        var branch = sourceData.get_Branch(path);
        if (branch == null || branch.Count == 0)
        {
          continue;
        }

        var convertedBranch = new List<GH_ValueListData>();
        var itemsTuples = StoredListItems.ConvertAll(x => (x.Name, x.Expression));

        foreach (var item in branch)
        {
          if (item == null)
          {
            continue;
          }

          if (item is GH_ValueListData vld)
          {
            convertedBranch.Add(vld);
          }
          else
          {
            string stringValue;

            if (item is GH_String ghString)
            {
              stringValue = ghString.Value;
            }
            else if (item is IGH_Goo goo)
            {
              // Try to cast to string
              if (goo.CastTo(out string castValue))
              {
                stringValue = castValue;
              }
              else
              {
                stringValue = goo.ToString();
              }
            }
            else
            {
              stringValue = item.ToString() ?? "";
            }

            var matchingIndex = -1;
            for (var i = 0; i < StoredListItems.Count; i++)
            {
              if (StoredListItems[i].Expression == stringValue)
              {
                matchingIndex = i;
                break;
              }
            }

            var selectedIndex = matchingIndex >= 0 ? matchingIndex : DefaultSelectedIndex;

            convertedBranch.Add(new GH_ValueListData(stringValue, itemsTuples, selectedIndex));
          }
        }

        if (convertedBranch.Count > 0)
        {
          m_data.AppendRange(convertedBranch, path);
        }
      }
    }
  }

  public override bool Write(GH_IWriter writer)
  {
    // Store contextual parameter properties
    writer.SetString("Prompt", Prompt ?? string.Empty);
    writer.SetInt32("AtLeast", AtLeast);
    writer.SetInt32("AtMost", AtMost);
    writer.SetBoolean("TreeAccess", TreeAccess);
    writer.SetBoolean("Immediate", Immediate);

    // Store the default selected index
    writer.SetInt32("DefaultSelectedIndex", DefaultSelectedIndex);

    // Store all items as JSON
    var itemsJson = new JArray();
    for (var i = 0; i < StoredListItems.Count; i++)
    {
      itemsJson.Add(new JObject
      {
        { "name", StoredListItems[i].Name },
        { "expression", StoredListItems[i].Expression }
      });
    }

    writer.SetString("StoredItems", itemsJson.ToString());

    // Store ValueList reference
    writer.SetString("ConnectedValueListGuid", _connectedValueListGuid.ToString());

    return base.Write(writer);
  }

  public override bool Read(GH_IReader reader)
  {
    Prompt = reader.GetString("Prompt");

    AtLeast = 1;
    AtMost = 1;
    TreeAccess = false;
    Immediate = true;

    var atLeastValue = 0;
    if (reader.TryGetInt32("AtLeast", ref atLeastValue))
    {
      AtLeast = atLeastValue;
    }

    var atMostValue = 0;
    if (reader.TryGetInt32("AtMost", ref atMostValue))
    {
      AtMost = atMostValue;
    }

    var treeAccessValue = false;
    if (reader.TryGetBoolean("TreeAccess", ref treeAccessValue))
    {
      TreeAccess = treeAccessValue;
    }

    var immediateValue = true;
    if (reader.TryGetBoolean("Immediate", ref immediateValue))
    {
      Immediate = immediateValue;
    }

    var defaultIndex = -1;
    reader.TryGetInt32("DefaultSelectedIndex", ref defaultIndex);
    DefaultSelectedIndex = defaultIndex;

    // Load stored items
    string itemsJson = null;
    if (reader.TryGetString("StoredItems", ref itemsJson) && !string.IsNullOrEmpty(itemsJson))
    {
      try
      {
        var array = JArray.Parse(itemsJson);
        StoredListItems.Clear();
        foreach (var item in array)
        {
          StoredListItems.Add(new GH_ValueListItem(
            item["name"]?.ToString() ?? "",
            item["expression"]?.ToString() ?? ""
          ));
        }
      }
      catch
      {
      }
    }

    // Load ValueList reference
    string guidStr = null;
    if (reader.TryGetString("ConnectedValueListGuid", ref guidStr) && !string.IsNullOrEmpty(guidStr) &&
        Guid.TryParse(guidStr, out var guid))
    {
      _connectedValueListGuid = guid;
    }

    return base.Read(reader);
  }
}
