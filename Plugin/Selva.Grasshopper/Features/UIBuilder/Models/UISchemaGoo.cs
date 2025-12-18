using System;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.Core.Models;
using Selva.Grasshopper.Utilities.Helpers;

namespace Selva.Grasshopper.Features.UIBuilder.Models;

public class UISchemaGoo : IGH_Goo
{
	public UISchemaGoo()
	{
	}

	public UISchemaGoo(UISchema value)
	{
		Value = value;
	}

	public UISchema Value { get; set; }

	public bool IsValid => Value != null;

	public string IsValidWhyNot => Value == null ? "UISchema is null" : string.Empty;

	public string TypeName => "UISchema";

	public string TypeDescription => "UI schema definition for Selva builder";

	public IGH_Goo Duplicate()
	{
		if (Value == null) return new UISchemaGoo();

		var json = JsonConvert.SerializeObject(Value, SchemaSerializationSettings.Settings);
		var copy = JsonConvert.DeserializeObject<UISchema>(json, SchemaSerializationSettings.Settings);
		return new UISchemaGoo(copy ?? Value);
	}

	public IGH_GooProxy EmitProxy()
	{
		return null;
	}

	public bool CastFrom(object source)
	{
		if (source is UISchema schema)
		{
			Value = schema;
			return true;
		}

		if (source is string s)
			try
			{
				Value = JsonConvert.DeserializeObject<UISchema>(s, SchemaSerializationSettings.Settings);
				return Value != null;
			}
			catch (Exception ex)
			{
				Logger.Warn($"Failed to cast to UISchema: {ex.Message}");
			}

		return false;
	}

	public bool CastTo<T>(out T target)
	{
		if (typeof(T).IsAssignableFrom(typeof(UISchema)))
		{
			target = (T)(object)Value;
			return true;
		}

		if (typeof(T) == typeof(string))
		{
			target = (T)(object)JsonConvert.SerializeObject(Value, SchemaSerializationSettings.Settings);
			return true;
		}

		target = default;
		return false;
	}

	public object ScriptVariable()
	{
		return Value;
	}

	public bool Write(GH_IWriter writer)
	{
		var json = JsonConvert.SerializeObject(Value, SchemaSerializationSettings.Settings);
		writer.SetString("UISchemaJson", json);
		return true;
	}

	public bool Read(GH_IReader reader)
	{
		if (!reader.ItemExists("UISchemaJson")) return false;

		var json = reader.GetString("UISchemaJson");
		Value = JsonConvert.DeserializeObject<UISchema>(json, SchemaSerializationSettings.Settings);
		return true;
	}

	public override string ToString()
	{
		if (Value == null) return "UISchema (null)";

		var inputCount = Value.Inputs?.Count ?? 0;
		var outputCount = Value.Outputs?.Count ?? 0;
		var layoutInfo = "unknown layout";

		if (Value.Layout is TabbedLayoutConfig tabbed)
			layoutInfo = $"{tabbed.Tabs?.Count ?? 0} tabs";
		else if (Value.Layout is FlatLayoutConfig flat) layoutInfo = $"{flat.Groups?.Count ?? 0} groups";

		return $"UISchema: {Value.Name} (inputs={inputCount}, outputs={outputCount}, {layoutInfo})";
	}
}
