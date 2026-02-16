using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq.Expressions;
using System.Reflection;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Core.Models;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Services;

namespace Selva.GH.Features.UIBuilder.Services.Persistence;

/// <summary>
///   Handles applying values from web UI to Grasshopper parameters
/// </summary>
public class ValueApplicator
{
	private const int MAX_STRING_LENGTH = AppConfig.ValueLimits.MaxStringLength;

	private static readonly Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)> TypeHandlers =
		new()
		{
			{ "number", (typeof(GH_Number), val => new GH_Number(Convert.ToDouble(val))) },
			{ "integer", (typeof(GH_Integer), val => new GH_Integer(Convert.ToInt32(val))) },
			{ "text", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
			{ "boolean", (typeof(GH_Boolean), val => new GH_Boolean(Convert.ToBoolean(val))) },
			{ "valueList", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
			{ "file", (typeof(FileInputGoo), val => {
				var json = val?.ToString() ?? "";
				try {
					var fileData = Newtonsoft.Json.JsonConvert.DeserializeObject<FileInputData>(json);
					return new FileInputGoo(fileData);
				} catch {
					return new FileInputGoo();
				}
			}) }
		};


	private static readonly ConcurrentDictionary<Type, ReflectionCache> _reflectionCache = new();

	private ConcurrentDictionary<string, object> _lastAppliedValues = new();

	/// <summary>
	///   Apply values from web UI to Grasshopper parameters and schedule a solution
	///   Uses the ScheduleSolution pattern for clean, predictable behavior
	/// </summary>
	/// <returns>Number of parameters updated</returns>
	public int ApplyValuesAndSchedule(GH_Document document, UISchema schema, Dictionary<string, object> values,
		Action<GH_RuntimeMessageLevel, string> addMessage)
	{
		var updateCount = 0;
		var pendingExpirations = new HashSet<IGH_ActiveObject>(); // Local snapshot, HashSet dedupes

		foreach (var input in schema.Inputs)
			try
			{
				var inputKey = input.Id.ToString();

				// Check if value exists in payload FIRST (filters before expensive FindObject)
				if (!values.TryGetValue(inputKey, out var value)) continue;

				// Only lookup parameter if we have a value to apply
				var paramObject = document.FindObject(input.Id, false);
				if (paramObject == null)
				{
					addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
						$"Parameter '{input.Nickname}' not found in document");
					continue;
				}

				if (!HasValueChanged(inputKey, value)) continue;

				// Validate value before applying (security check)
				if (!ValidateValue(input, value, addMessage)) continue; // Skip invalid values

				if (paramObject is IGH_ContextualParameter contextParam)
				{
					var success =
						ApplyToContextualParameter(contextParam, input.ParamType, value, addMessage, pendingExpirations);
					if (success)
					{
						updateCount++;
						_lastAppliedValues[inputKey] = value;

						if (paramObject is IGH_ActiveObject activeObj) pendingExpirations.Add(activeObj);
					}
				}
				else if (input.ParamType == "file")
				{
					// Handle file parameters that aren't contextual (e.g., regular input parameters)
					var success = ApplyToFileParameter(paramObject, value, addMessage, pendingExpirations);
					if (success)
					{
						updateCount++;
						_lastAppliedValues[inputKey] = value;

						if (paramObject is IGH_ActiveObject activeObj) pendingExpirations.Add(activeObj);
					}
				}
			}
			catch (Exception ex)
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
					$"Error applying value to '{input.Nickname}': {ex.Message}");
			}

		// Schedule expiration with local snapshot (thread-safe)
		if (pendingExpirations.Count > 0)
		{
			var toExpire = pendingExpirations; // Capture for closure
			document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc =>
			{
				foreach (var obj in toExpire) obj.ExpireSolution(false);
			});
		}

		return updateCount;
	}

	/// <summary>
	///   Check if value has changed since last application
	/// </summary>
	public bool HasValueChanged(string key, object newValue)
	{
		if (_lastAppliedValues.TryGetValue(key, out var lastValue)) return newValue?.ToString() != lastValue?.ToString();

		return true;
	}

	/// <summary>
	///   Get or create cached reflection results for a given type
	/// </summary>
	private ReflectionCache GetOrCreateCache(Type ghType)
	{
		return _reflectionCache.GetOrAdd(ghType, type =>
		{
			var dataTreeType = typeof(DataTree<>).MakeGenericType(type);
			var constructor = dataTreeType.GetConstructor(Type.EmptyTypes);

			return new ReflectionCache
			{
				DataTreeType = dataTreeType,
				AddMethod = dataTreeType.GetMethod("Add", new[] { type, typeof(GH_Path) }),
				CreateInstance = constructor != null
					? Expression.Lambda<Func<object>>(Expression.New(constructor)).Compile()
					: () => Activator.CreateInstance(dataTreeType)
			};
		});
	}

	/// <summary>
	///   Get the last applied values dictionary
	/// </summary>
	public Dictionary<string, object> GetLastAppliedValues()
	{
		return new Dictionary<string, object>(_lastAppliedValues);
	}

	/// <summary>
	///   Set the last applied values (used when loading from embedded data)
	/// </summary>
	public void SetLastAppliedValues(Dictionary<string, object> values)
	{
		_lastAppliedValues = new ConcurrentDictionary<string, object>(values);
	}

	/// <summary>
	///   Remove specific values by keys (thread-safe)
	///   Used when parameters are deleted from the document
	/// </summary>
	public void RemoveValues(IEnumerable<string> keys)
	{
		if (keys == null) return;

		foreach (var key in keys) _lastAppliedValues.TryRemove(key, out _);
	}

	/// <summary>
	///   Clear all tracked values
	/// </summary>
	public void Clear()
	{
		_lastAppliedValues.Clear();
	}

	/// <summary>
	///   Validate input value against security constraints
	///   Note: Parameter range constraints (min/max) are enforced at UI level and not redundantly checked here
	/// </summary>
	private bool ValidateValue(SchemaInput input, object value,
		Action<GH_RuntimeMessageLevel, string> addMessage)
	{
		if (value == null) return true; // null is acceptable

		try
		{
			// Validate string length (excluding file input data which has separate limits)
			if (value is string strValue && input.ParamType != "file")
				if (strValue.Length > MAX_STRING_LENGTH)
				{
					addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
						$"String value too long for '{input.Nickname}' (max {MAX_STRING_LENGTH} characters)");
					return false;
				}

			// Validate numeric type conversions
			if (input.ParamType == "Number" || input.ParamType == "Integer")
			{
				double numValue;
				try
				{
					numValue = Convert.ToDouble(value);
				}
				catch (Exception)
				{
					addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
						$"Invalid numeric value for '{input.Nickname}'");
					return false;
				}

				// Sanity check for extremely large numbers (potential DoS/overflow)
				if (double.IsInfinity(numValue) || double.IsNaN(numValue))
				{
					addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
						$"Invalid numeric value for '{input.Nickname}' (Infinity or NaN)");
					return false;
				}
			}

			// Validate integer conversion
			if (input.ParamType == "Integer")
				try
				{
					Convert.ToInt32(value);
				}
				catch (OverflowException)
				{
					addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
						$"Integer value overflow for '{input.Nickname}'");
					return false;
				}

			return true;
		}
		catch (Exception ex)
		{
			addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
				$"Validation error for '{input.Nickname}': {ex.Message}");
			return false;
		}
	}

	/// <summary>
	///   Apply a value to a contextual parameter using reflection and type handlers
	///   Uses cached reflection to eliminate overhead
	/// </summary>
	private bool ApplyToContextualParameter(IGH_ContextualParameter contextParam, string paramTypeName,
		object value, Action<GH_RuntimeMessageLevel, string> addMessage, HashSet<IGH_ActiveObject> pendingExpirations)
	{
		try
		{
			// Special handling for ValueList - use the parameter's native type
			if (paramTypeName == "valueList") return ApplyToValueList(contextParam, value, addMessage, pendingExpirations);

			// Special handling for file parameters - don't use AssignContextualDataTree
			if (paramTypeName == "file")
			{
				return ApplyToFileParameter((object)contextParam, value, addMessage, pendingExpirations);
			}

			if (!TypeHandlers.TryGetValue(paramTypeName, out var handler))
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
					$"Unsupported parameter type: {paramTypeName}");
				return false;
			}

			var ghValue = handler.Converter(value);

			var cache = GetOrCreateCache(handler.GhType);

			var dataTree = cache.CreateInstance();
			if (cache.AddMethod == null)
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
					$"Could not find Add method for type {handler.GhType.Name}");
				return false;
			}

			cache.AddMethod.Invoke(dataTree, new object[] { ghValue, new GH_Path(0) });

			var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
			if (method != null)
			{
				method.Invoke(contextParam, new[] { dataTree });
				return true;
			}

			addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
				"Could not find AssignContextualDataTree method");
			return false;
		}
		catch (Exception ex)
		{
			addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
				$"Error applying value: {ex.Message}");
		}

		return false;
	}

	/// <summary>
	///   Apply a value to a ValueList parameter by selecting the item by name
	///   Also adds the connected GH_ValueList to pending expirations
	/// </summary>
	private bool ApplyToValueList(IGH_ContextualParameter contextParam, object value,
		Action<GH_RuntimeMessageLevel, string> addMessage, HashSet<IGH_ActiveObject> pendingExpirations)
	{
		try
		{
			var selectedKey = value?.ToString();
			if (string.IsNullOrEmpty(selectedKey))
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Warning, "ValueList value is null or empty");
				return false;
			}

			// Try to use the simple SelectItemByName method
			var selectMethod = contextParam.GetType().GetMethod("SelectItemByName");
			if (selectMethod != null)
			{
				var result = selectMethod.Invoke(contextParam, new object[] { selectedKey });
				if (result is bool success && success)
				{
					// Also add the connected GH_ValueList to pending expirations
					// This ensures the actual ValueList component gets expired too
					var connectedVLProperty = contextParam.GetType().GetProperty("ConnectedValueList",
						BindingFlags.NonPublic | BindingFlags.Instance);
					if (connectedVLProperty?.GetValue(contextParam) is IGH_ActiveObject connectedVL)
						pendingExpirations.Add(connectedVL);

					return true;
				}

				addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
					$"Could not find item '{selectedKey}' in ValueList");
				return false;
			}

			addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
				"Could not find SelectItemByName method on ValueList parameter");
			return false;
		}
		catch (Exception ex)
		{
			addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
				$"Error applying ValueList value: {ex.Message}");
			return false;
		}
	}

	/// <summary>
	///   Apply a file value to a regular (non-contextual) parameter
	///   Handles parameters like File_Selector or generic input parameters
	///   File value can be: JSON string, JObject, or FileInputData instance
	/// </summary>
	private bool ApplyToFileParameter(object paramObject, object value,
		Action<GH_RuntimeMessageLevel, string> addMessage, HashSet<IGH_ActiveObject> pendingExpirations)
	{
		try
		{
			// Only handle IGH_Param instances for file assignment
			if (!(paramObject is IGH_Param param))
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
					$"File parameter is not an IGH_Param");
				return false;
			}

			// Deserialize the file data - handle multiple formats
			FileInputData fileData = null;

			try
			{
				// Try to handle different input formats
				if (value is FileInputData existingData)
				{
					// Already deserialized
					fileData = existingData;
				}
				else if (value is Newtonsoft.Json.Linq.JObject jObject)
				{
					// Convert JObject to FileInputData
					fileData = jObject.ToObject<FileInputData>();
				}
				else if (value is Dictionary<string, object> dict)
				{
					// Convert dictionary to FileInputData
					fileData = Newtonsoft.Json.JsonConvert.DeserializeObject<FileInputData>(
						Newtonsoft.Json.JsonConvert.SerializeObject(dict));
				}
				else
				{
					// Try to parse as string
					var strValue = value?.ToString() ?? "";

					// Check if it looks like a JSON object (starts with {)
					if (strValue.TrimStart().StartsWith("{"))
					{
						// Parse as JSON
						fileData = Newtonsoft.Json.JsonConvert.DeserializeObject<FileInputData>(strValue);
					}
					else if (strValue.StartsWith("http://") || strValue.StartsWith("https://"))
					{
						// It's a URL - auto-create FileInputData
						fileData = FileInputData.FromUrl(strValue);
					}
					else if (!string.IsNullOrEmpty(strValue))
					{
						// It's a file path - auto-create FileInputData
						fileData = FileInputData.FromPath(strValue);
					}
					else
					{
						addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
							$"File data is empty");
						return false;
					}
				}
			}
			catch (Exception ex)
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
					$"Invalid file data format: {ex.Message}");
				return false;
			}

			if (fileData == null || string.IsNullOrEmpty(fileData.Type) || string.IsNullOrEmpty(fileData.File))
			{
				addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
					$"File data missing required fields (type: {fileData?.Type ?? "null"}, file: {(string.IsNullOrEmpty(fileData?.File) ? "empty" : fileData.File.Length + " chars")})");
				return false;
			}

			// Create a FileInputGoo and add it to the parameter's VolatileData
			var fileGoo = new FileInputGoo(fileData);

			// Try AssignContextualData first (for GetFileParameter and similar contextual file parameters)
			if (param is IGH_ContextualParameter contextualParam)
			{
				var assignContextualDataMethod = param.GetType().GetMethod("AssignContextualData",
					new[] { typeof(IEnumerable) });
				if (assignContextualDataMethod != null)
				{
					try
					{
						// Create a list with the FileInputGoo
						var dataList = new List<object> { fileGoo };
						assignContextualDataMethod.Invoke(param, new object[] { dataList });

						// Mark parameter as modified so it updates downstream
						if (paramObject is IGH_ActiveObject activeObj)
						{
							pendingExpirations.Add(activeObj);
						}

						return true;
					}
					catch (Exception ex)
					{
						Utilities.Helpers.Logger.Log($"[ValueApplicator] AssignContextualData failed: {ex.Message}");
					}
				}
			}

			// Fallback: Try standard data tree methods
			var dataTree = new DataTree<FileInputGoo>();
			dataTree.Add(fileGoo, new GH_Path(0));

			// Attempt 1: AddVolatileDataTree with IGH_DataTree
			var addVolatileMethod = param.GetType().GetMethod("AddVolatileDataTree",
				new[] { typeof(IGH_DataTree) });
			if (addVolatileMethod != null)
			{
				try
				{
					addVolatileMethod.Invoke(param, new object[] { dataTree });

					if (paramObject is IGH_ActiveObject activeObj)
					{
						pendingExpirations.Add(activeObj);
					}

					return true;
				}
				catch (Exception ex)
				{
					Utilities.Helpers.Logger.Log($"[ValueApplicator] AddVolatileDataTree failed: {ex.Message}");
				}
			}

			// Attempt 2: AddVolatileData with IGH_Goo
			param.ClearData();
			var addMethod = param.GetType().GetMethod("AddVolatileData",
				new[] { typeof(IGH_Goo) });
			if (addMethod != null)
			{
				try
				{
					addMethod.Invoke(param, new object[] { fileGoo });

					if (paramObject is IGH_ActiveObject activeObj)
					{
						pendingExpirations.Add(activeObj);
					}

					return true;
				}
				catch (Exception ex)
				{
					Utilities.Helpers.Logger.Log($"[ValueApplicator] AddVolatileData failed: {ex.Message}");
				}
			}

			addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
				$"Could not find any method to assign file data to parameter (tried: AssignContextualData, AddVolatileDataTree, AddVolatileData)");
			return false;

			// Mark parameter as modified so it updates downstream (unreachable, but kept for structure)
			/*if (paramObject is IGH_ActiveObject activeObj)
			{
				pendingExpirations.Add(activeObj);
			}*/

			/*return true;*/
		}
		catch (Exception ex)
		{
			addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
				$"Error applying file value: {ex.Message}");
			return false;
		}
	}

	/// <summary>
	///   Cache for reflection results per type - eliminates overhead per parameter update
	/// </summary>
	private class ReflectionCache
	{
		public MethodInfo AddMethod;
		public Func<object> CreateInstance;
		public Type DataTreeType;
	}
}
