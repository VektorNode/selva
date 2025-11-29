using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;

namespace Selva.Features.ComputeIO.Components;

/// <summary>
///   Custom IGH_Goo type for ValueList data
/// </summary>
[Guid("F5A0C45C-1B2D-4E7F-9A3C-8D2E5F7B4C6A")]
public class GH_ValueListDataGoo : GH_Goo<string>
{
  public GH_ValueListDataGoo()
  {
  }

  public GH_ValueListDataGoo(string value, List<(string Name, string Expression)> items, int selectedIndex = 0)
  {
    Value = value;
    Items = items;
    SelectedIndex = selectedIndex;
  }

  public override string TypeName => "ValueList";

  public override string TypeDescription => "A value from a ValueList with metadata";

  public List<(string Name, string Expression)> Items { get; private set; } = new();

  public int SelectedIndex { get; private set; } = -1;

  /// <summary>
  ///   Gets the name/key of the currently selected item
  /// </summary>
  public string SelectedName
  {
    get
    {
      if (SelectedIndex >= 0 && SelectedIndex < Items.Count) return Items[SelectedIndex].Name;

      return string.Empty;
    }
  }

  /// <summary>
  ///   Gets the expression/value of the currently selected item (same as Value property)
  /// </summary>
  public string SelectedExpression => Value;

  public override bool IsValid => !string.IsNullOrEmpty(Value);

  public override IGH_Goo Duplicate()
  {
    return new GH_ValueListDataGoo(Value, new List<(string, string)>(Items), SelectedIndex);
  }

  public override string ToString()
  {
    return Value ?? "null";
  }

  public override IGH_GooProxy EmitProxy()
  {
    return new GH_ValueListDataProxy(this);
  }

  /// <summary>
  ///   Gets the selected item as a key-value tuple (Name, Expression)
  /// </summary>
  public (string Name, string Expression) GetSelectedItem()
  {
    if (SelectedIndex >= 0 && SelectedIndex < Items.Count) return Items[SelectedIndex];

    return (string.Empty, Value ?? string.Empty);
  }

  /// <summary>
  ///   Gets the selected item as a JObject with "name" and "expression" properties
  /// </summary>
  public JObject GetSelectedItemAsJson()
  {
    var item = GetSelectedItem();
    return new JObject
    {
      { "name", item.Name },
      { "expression", item.Expression }
    };
  }

  public JObject ToJson()
  {
    var json = new JObject
    {
      { "value", Value },
      { "selectedIndex", SelectedIndex },
      { "items", JArray.FromObject(Items.ConvertAll(x => new { x.Name, x.Expression })) }
    };
    return json;
  }

  /// <summary>
  ///   Returns the default value (selected value)
  /// </summary>
  public string GetDefaultValue()
  {
    if (SelectedIndex >= 0 && SelectedIndex < Items.Count) return Items[SelectedIndex].Expression;

    return Value; // Fallback to current value
  }

  public static GH_ValueListDataGoo FromJson(JObject json)
  {
    if (json == null) return null;

    var value = json["value"]?.ToString();
    var selectedIndex = json["selectedIndex"]?.Value<int>() ?? 0;
    var itemsArray = json["items"] as JArray;

    var items = new List<(string Name, string Expression)>();
    if (itemsArray != null)
      foreach (var item in itemsArray)
      {
        items.Add((
          item["Name"]?.ToString() ?? "",
          item["Expression"]?.ToString() ?? ""
        ));
      }

    return new GH_ValueListDataGoo(value, items, selectedIndex);
  }

  public override bool CastFrom(object source)
  {
    if (source == null) return false;

    if (source is GH_ValueListDataGoo vld)
    {
      Value = vld.Value;
      Items = new List<(string, string)>(vld.Items);
      SelectedIndex = vld.SelectedIndex;
      return true;
    }

    if (source is string str)
    {
      Value = str;
      return true;
    }

    if (source is GH_String ghStr)
    {
      Value = ghStr.Value;
      return true;
    }

    if (source is int intVal)
    {
      Value = intVal.ToString();
      return true;
    }

    if (source is double doubleVal)
    {
      Value = doubleVal.ToString();
      return true;
    }

    if (source is float floatVal)
    {
      Value = floatVal.ToString();
      return true;
    }

    Value = source.ToString();
    return true;
  }

  public override bool CastTo<T>(ref T target)
  {
    // Cast to string
    if (typeof(T) == typeof(GH_String))
    {
      object obj = new GH_String(Value);
      target = (T)obj;
      return true;
    }

    if (typeof(T) == typeof(GH_ValueListDataGoo))
    {
      object obj = this;
      target = (T)obj;
      return true;
    }

    if (typeof(T) == typeof(GH_Number))
    {
      if (double.TryParse(Value, out var numValue))
      {
        object obj = new GH_Number(numValue);
        target = (T)obj;
        return true;
      }

      return false;
    }

    if (typeof(T) == typeof(GH_Integer))
    {
      if (int.TryParse(Value, out var intValue))
      {
        object obj = new GH_Integer(intValue);
        target = (T)obj;
        return true;
      }

      return false;
    }

    if (typeof(T) == typeof(GH_Boolean))
    {
      if (bool.TryParse(Value, out var boolValue))
      {
        object obj = new GH_Boolean(boolValue);
        target = (T)obj;
        return true;
      }

      if (double.TryParse(Value, out var numValue))
      {
        object obj = new GH_Boolean(Math.Abs(numValue) > 1e-10);
        target = (T)obj;
        return true;
      }

      return false;
    }

    return false;
  }

  private class GH_ValueListDataProxy : GH_GooProxy<GH_ValueListDataGoo>
  {
    public GH_ValueListDataProxy(GH_ValueListDataGoo owner) : base(owner)
    {
    }

    public override bool IsParsable => true;

    /// <summary>
    ///   The name/key of the selected item
    /// </summary>
    public string Name => Owner.SelectedName;

    /// <summary>
    ///   The expression/value of the selected item
    /// </summary>
    public string Expression => Owner.Value;

    /// <summary>
    ///   The default value (same as Expression)
    /// </summary>
    public string Default => Owner.GetDefaultValue();

    /// <summary>
    ///   All available values in the list as a key-value object
    /// </summary>
    public JObject Values
    {
      get
      {
        var valuesObj = new JObject();
        foreach (var item in Owner.Items)
        {
          valuesObj[item.Name] = item.Expression;
        }

        return valuesObj;
      }
    }

    public override bool FromString(string input)
    {
      if (input == null) input = string.Empty;

      Owner.Value = input;
      return true;
    }
  }
}
