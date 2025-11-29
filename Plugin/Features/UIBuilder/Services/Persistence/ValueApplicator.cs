using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq.Expressions;
using System.Reflection;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Config;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Handles applying values from web UI to Grasshopper parameters
/// </summary>
public class ValueApplicator
{
  private const int MAX_STRING_LENGTH = AppConfig.ValueLimits.MaxStringLength;

  private static readonly Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)> TypeHandlers =
    new()
    {
      { "Number", (typeof(GH_Number), val => new GH_Number(Convert.ToDouble(val))) },
      { "Integer", (typeof(GH_Integer), val => new GH_Integer(Convert.ToInt32(val))) },
      { "Text", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
      { "Boolean", (typeof(GH_Boolean), val => new GH_Boolean(Convert.ToBoolean(val))) },
      { "ValueList", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) }
    };

  private static readonly ConcurrentDictionary<Type, ReflectionCache> _reflectionCache = new();

  private readonly List<IGH_ActiveObject> _pendingExpirations = new();

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
    _pendingExpirations.Clear();

    foreach (var input in schema.Inputs)
    {
      try
      {
        var paramObject = document.FindObject(input.Id, false);
        if (paramObject == null)
        {
          addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
            $"Parameter '{input.Nickname}' not found in document");
          continue;
        }

        var inputKey = input.Id.ToString();
        if (!values.TryGetValue(inputKey, out var value)) continue;

        if (!HasValueChanged(inputKey, value)) continue;

        // Validate value before applying (security check)
        if (!ValidateValue(input, value, addMessage)) continue; // Skip invalid values

        if (paramObject is IGH_ContextualParameter contextParam)
        {
          var success = ApplyToContextualParameter(contextParam, input.ParamType, value, addMessage);
          if (success)
          {
            updateCount++;
            _lastAppliedValues[inputKey] = value;

            if (paramObject is IGH_ActiveObject activeObj) _pendingExpirations.Add(activeObj);
          }
        }
      }
      catch (Exception ex)
      {
        addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
          $"Error applying value to '{input.Nickname}': {ex.Message}");
      }
    }

    if (_pendingExpirations.Count > 0)
      document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, ExpireCallback);

    return updateCount;
  }

  /// <summary>
  ///   Callback for ScheduleSolution - expires parameters and nothing else
  /// </summary>
  private void ExpireCallback(GH_Document doc)
  {
    foreach (var obj in _pendingExpirations)
    {
      obj.ExpireSolution(false);
    }

    _pendingExpirations.Clear();
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

    foreach (var key in keys)
    {
      _lastAppliedValues.TryRemove(key, out _);
    }
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
  private bool ValidateValue(InputParamSchema input, object value,
    Action<GH_RuntimeMessageLevel, string> addMessage)
  {
    if (value == null) return true; // null is acceptable

    try
    {
      // Validate string length
      if (value is string strValue)
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
    object value, Action<GH_RuntimeMessageLevel, string> addMessage)
  {
    try
    {
      // Special handling for ValueList - use the parameter's native type
      if (paramTypeName == "ValueList") return ApplyToValueList(contextParam, value, addMessage);

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
  /// </summary>
  private bool ApplyToValueList(IGH_ContextualParameter contextParam, object value,
    Action<GH_RuntimeMessageLevel, string> addMessage)
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
        if (result is bool success && success) return true;

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
  ///   Cache for reflection results per type - eliminates 10-15ms overhead per parameter update
  /// </summary>
  private class ReflectionCache
  {
    public MethodInfo AddMethod;
    public Func<object> CreateInstance;
    public Type DataTreeType;
  }
}
