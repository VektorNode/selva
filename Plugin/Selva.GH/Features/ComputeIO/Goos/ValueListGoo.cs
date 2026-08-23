using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.ComputeIO.Goos;

[Guid("F5A0C45C-1B2D-4E7F-9A3C-8D2E5F7B4C6A")]
public class GH_ValueListDataGoo : GH_Goo<string>
{
    // When true, an empty Value still counts as valid: the dynamic value list emits an intentional
    // empty placeholder on the first solve, before any computed options arrive, and downstream params
    // shouldn't drop it. Defaults to false so the static value list keeps its empty-is-invalid behavior.
    private readonly bool _allowEmpty;

    public GH_ValueListDataGoo()
    {
    }

    public GH_ValueListDataGoo(string value, List<(string Name, string Expression)> items,
        int selectedIndex = 0, bool allowEmpty = false)
    {
        Value = value;
        Items = items;
        SelectedIndex = selectedIndex;
        _allowEmpty = allowEmpty;
    }

    public override string TypeName => "ValueList";

    public override string TypeDescription => "A value from a ValueList with metadata";

    public List<(string Name, string Expression)> Items { get; private set; } =
        new List<(string Name, string Expression)>();

    public int SelectedIndex { get; private set; } = -1;

    public string SelectedName
    {
        get
        {
            if (SelectedIndex >= 0 && SelectedIndex < Items.Count)
            {
                return Items[SelectedIndex].Name;
            }

            return string.Empty;
        }
    }

    public string SelectedExpression => Value;

    public override bool IsValid => _allowEmpty || !string.IsNullOrEmpty(Value);

    // Returns the name (key), not the expression, so Grasshopper UI builders get e.g. "Sphere" instead of "0".
    public string SerializeValue()
    {
        return SelectedName ?? Value ?? string.Empty;
    }

    public override IGH_Goo Duplicate()
    {
        return new GH_ValueListDataGoo(Value, new List<(string, string)>(Items), SelectedIndex, _allowEmpty);
    }

    public override string ToString()
    {
        return Value ?? "null";
    }

    public override IGH_GooProxy EmitProxy()
    {
        return new GH_ValueListDataProxy(this);
    }

    public (string Name, string Expression) GetSelectedItem()
    {
        if (SelectedIndex >= 0 && SelectedIndex < Items.Count)
        {
            return Items[SelectedIndex];
        }

        return (string.Empty, Value ?? string.Empty);
    }

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
            { "name", SelectedName },
            { "selectedIndex", SelectedIndex },
            { "items", JArray.FromObject(Items.ConvertAll(x => new { x.Name, x.Expression })) }
        };
        return json;
    }

    public string GetDefaultValue()
    {
        if (SelectedIndex >= 0 && SelectedIndex < Items.Count)
        {
            return Items[SelectedIndex].Expression;
        }

        return Value;
    }

    public static GH_ValueListDataGoo FromJson(JObject json)
    {
        if (json == null)
        {
            return null;
        }

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

        return new GH_ValueListDataGoo(value, items, selectedIndex);
    }

    // Compute returns the name (key); look it up here to recover the expression.
    public static GH_ValueListDataGoo FromComputeValue(string incomingValue,
        List<(string Name, string Expression)> items)
    {
        if (string.IsNullOrEmpty(incomingValue) || items == null || items.Count == 0)
        {
            return new GH_ValueListDataGoo(incomingValue, items ?? new List<(string, string)>(), -1);
        }

        for (var i = 0; i < items.Count; i++)
        {
            if (items[i].Name == incomingValue)
            {
                return new GH_ValueListDataGoo(items[i].Expression, items, i);
            }
        }

        return new GH_ValueListDataGoo(incomingValue, items, -1);
    }

    public override bool CastFrom(object source)
    {
        if (source == null)
        {
            return false;
        }

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
            Value = intVal.ToString(CultureInfo.InvariantCulture);
            return true;
        }

        if (source is double doubleVal)
        {
            Value = doubleVal.ToString(CultureInfo.InvariantCulture);
            return true;
        }

        if (source is float floatVal)
        {
            Value = floatVal.ToString(CultureInfo.InvariantCulture);
            return true;
        }

        Value = source.ToString();
        return true;
    }

    private string FindNameByExpression(string expression)
    {
        if (expression == null)
        {
            return string.Empty;
        }

        foreach (var item in Items)
        {
            if (item.Expression == expression)
            {
                return item.Name;
            }
        }

        return string.Empty;
    }

    public override bool CastTo<T>(ref T target)
    {
        if (typeof(T) == typeof(GH_String))
        {
            object obj = new GH_String(Value ?? string.Empty);
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
            if (double.TryParse(Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var numValue))
            {
                object obj = new GH_Number(numValue);
                target = (T)obj;
                return true;
            }

            return false;
        }

        if (typeof(T) == typeof(GH_Integer))
        {
            if (int.TryParse(Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var intValue))
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

            if (double.TryParse(Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var numValue))
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

        public string Name => Owner.SelectedName;

        public string Expression => Owner.Value;

        public string Default => Owner.GetDefaultValue();

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
            if (input == null)
            {
                input = string.Empty;
            }

            // Receives the name (key), not the expression: look up the matching item's expression.
            for (var i = 0; i < Owner.Items.Count; i++)
            {
                if (Owner.Items[i].Name == input)
                {
                    var item = Owner.Items[i];
                    Owner.Value = item.Expression;
                    return true;
                }
            }

            Owner.Value = input;
            return true;
        }
    }
}
