using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;

namespace Compuceraptor.Components.Params;

/// <summary>
/// Custom IGH_Goo type for ValueList data
/// </summary>
[Guid("F5A0C45C-1B2D-4E7F-9A3C-8D2E5F7B4C6A")]
public class GH_ValueListData : GH_Goo<string>
{
    private List<(string Name, string Expression)> _items = new List<(string, string)>();
    private int _selectedIndex = -1;

    public GH_ValueListData() { }

    public GH_ValueListData(string value, List<(string Name, string Expression)> items, int selectedIndex = 0)
    {
        Value = value;
        _items = items;
        _selectedIndex = selectedIndex;
    }

    public override IGH_Goo Duplicate() => new GH_ValueListData(Value, new List<(string, string)>(_items), _selectedIndex);

    public override string ToString()
    {
        return Value ?? "null";
    }

    public override string TypeName => "ValueList";

    public override string TypeDescription => "A value from a ValueList with metadata";

    public override IGH_GooProxy EmitProxy()
    {
        return new GH_ValueListDataProxy(this);
    }

    private class GH_ValueListDataProxy : GH_GooProxy<GH_ValueListData>
    {
        public GH_ValueListDataProxy(GH_ValueListData owner) : base(owner)
        {
        }

        public override bool IsParsable => true;

        /// <summary>
        /// The name/key of the selected item
        /// </summary>
        public string Name => Owner.SelectedName;

        /// <summary>
        /// The expression/value of the selected item
        /// </summary>
        public string Expression => Owner.Value;

        /// <summary>
        /// The default value (same as Expression)
        /// </summary>
        public string Default => Owner.GetDefaultValue();

        /// <summary>
        /// All available values in the list as a key-value object
        /// </summary>
        public JObject Values
        {
            get
            {
                var valuesObj = new JObject();
                foreach (var item in Owner._items)
                {
                    valuesObj[item.Name] = item.Expression;
                }
                return valuesObj;
            }
        }

        public override bool FromString(string input)
        {
            if (input == null)
                input = string.Empty;
            Owner.Value = input;
            return true;
        }
    }

    public List<(string Name, string Expression)> Items => _items;

    public int SelectedIndex => _selectedIndex;

    /// <summary>
    /// Gets the name/key of the currently selected item
    /// </summary>
    public string SelectedName
    {
        get
        {
            if (_selectedIndex >= 0 && _selectedIndex < _items.Count)
                return _items[_selectedIndex].Name;
            return string.Empty;
        }
    }

    /// <summary>
    /// Gets the expression/value of the currently selected item (same as Value property)
    /// </summary>
    public string SelectedExpression => Value;

    /// <summary>
    /// Gets the selected item as a key-value tuple (Name, Expression)
    /// </summary>
    public (string Name, string Expression) GetSelectedItem()
    {
        if (_selectedIndex >= 0 && _selectedIndex < _items.Count)
            return _items[_selectedIndex];
        return (string.Empty, Value ?? string.Empty);
    }

    /// <summary>
    /// Gets the selected item as a JObject with "name" and "expression" properties
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
            { "selectedIndex", _selectedIndex },
            { "items", JArray.FromObject(_items.ConvertAll(x => new { x.Name, x.Expression })) }
        };
        return json;
    }

    /// <summary>
    /// Returns values as an object for contextual serialization
    /// </summary>
    public JObject GetValuesObject()
    {
        var valuesObj = new JObject();
        foreach (var item in _items)
        {
            valuesObj[item.Name] = item.Expression;
        }
        return valuesObj;
    }

    /// <summary>
    /// Returns the default value (selected value)
    /// </summary>
    public string GetDefaultValue()
    {
        if (_selectedIndex >= 0 && _selectedIndex < _items.Count)
            return _items[_selectedIndex].Expression;
        return Value; // Fallback to current value
    }

    public static GH_ValueListData FromJson(JObject json)
    {
        if (json == null)
            return null;

        var value = json["value"]?.ToString();
        var selectedIndex = json["selectedIndex"]?.Value<int>() ?? 0;
        var itemsArray = json["items"] as JArray;

        var items = new List<(string Name, string Expression)>();
        if (itemsArray != null)
        {
            foreach (var item in itemsArray)
            {
                items.Add((
                    item["Name"]?.ToString() ?? "",
                    item["Expression"]?.ToString() ?? ""
                ));
            }
        }

        return new GH_ValueListData(value, items, selectedIndex);
    }

    public override bool CastFrom(object source)
    {
        if (source == null)
            return false;

        if (source is GH_ValueListData vld)
        {
            Value = vld.Value;
            _items = new List<(string, string)>(vld._items);
            _selectedIndex = vld._selectedIndex;
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

        // Handle numeric types
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

        // Fallback: convert anything to string
        Value = source.ToString();
        return true;
    }

    public override bool IsValid => !string.IsNullOrEmpty(Value);

    public override bool CastTo<T>(ref T target)
    {
        // Cast to string
        if (typeof(T) == typeof(GH_String))
        {
            object obj = new GH_String(Value);
            target = (T)obj;
            return true;
        }

        // Cast to same type
        if (typeof(T) == typeof(GH_ValueListData))
        {
            object obj = this;
            target = (T)obj;
            return true;
        }

        // Cast to double/number
        if (typeof(T) == typeof(GH_Number))
        {
            if (double.TryParse(Value, out double numValue))
            {
                object obj = new GH_Number(numValue);
                target = (T)obj;
                return true;
            }
            return false;
        }

        // Cast to integer
        if (typeof(T) == typeof(GH_Integer))
        {
            if (int.TryParse(Value, out int intValue))
            {
                object obj = new GH_Integer(intValue);
                target = (T)obj;
                return true;
            }
            return false;
        }

        // Cast to boolean
        if (typeof(T) == typeof(GH_Boolean))
        {
            if (bool.TryParse(Value, out bool boolValue))
            {
                object obj = new GH_Boolean(boolValue);
                target = (T)obj;
                return true;
            }
            // Also try numeric conversion (0 = false, non-zero = true)
            if (double.TryParse(Value, out double numValue))
            {
                object obj = new GH_Boolean(Math.Abs(numValue) > 1e-10);
                target = (T)obj;
                return true;
            }
            return false;
        }

        return false;
    }
}