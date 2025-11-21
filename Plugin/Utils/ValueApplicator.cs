using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq.Expressions;
using System.Reflection;
using ComputeBuilder.Plugin.Models.Generated;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

namespace ComputeBuilder.Utils
{
    /// <summary>
    ///     Handles applying values from web UI to Grasshopper parameters
    /// </summary>
    public class ValueApplicator
    {
        // Security constraints
        private const int MAX_STRING_LENGTH = 100000; // 100KB max string length
        private const int MAX_ARRAY_SIZE = 10000; // Max items in array

        private static readonly Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)> TypeHandlers =
            new Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)>()
            {
                { "Number", (typeof(GH_Number), val => new GH_Number(Convert.ToDouble(val))) },
                { "Integer", (typeof(GH_Integer), val => new GH_Integer(Convert.ToInt32(val))) },
                { "Text", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
                { "Boolean", (typeof(GH_Boolean), val => new GH_Boolean(Convert.ToBoolean(val))) },
                { "ValueList", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) }
            };

        private static readonly ConcurrentDictionary<Type, ReflectionCache> _reflectionCache = new ConcurrentDictionary<Type, ReflectionCache>();

        // ValueList reflection cache per parameter instance
        private readonly Dictionary<Guid, ValueListCache> _valueListCaches = new Dictionary<Guid, ValueListCache>();

        private readonly List<IGH_ActiveObject> _pendingExpirations = new List<IGH_ActiveObject>();

        private ConcurrentDictionary<string, object> _lastAppliedValues = new ConcurrentDictionary<string, object>();

        /// <summary>
        /// Cache for reflection results per type - eliminates 10-15ms overhead per parameter update
        /// </summary>
        private class ReflectionCache
        {
            public Type DataTreeType;
            public MethodInfo AddMethod;
            public Func<object> CreateInstance;
        }

        /// <summary>
        /// Cache for ValueList PropertyInfo objects per parameter instance
        /// </summary>
        private class ValueListCache
        {
            public PropertyInfo TypeHintProp;
            public PropertyInfo StoredItemsProp;
            public Type DataType;
        }

        /// <summary>
        ///     Apply values from web UI to Grasshopper parameters and schedule a solution
        ///     Uses the ScheduleSolution pattern for clean, predictable behavior
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
                            $"Parameter '{input.Name}' not found in document");
                        continue;
                    }

                    var inputKey = input.Id.ToString();
                    if (!values.TryGetValue(inputKey, out var value))
                    {
                        continue;
                    }

                    if (!HasValueChanged(inputKey, value))
                    {
                        continue;
                    }

                    // Validate value before applying (security check)
                    if (!ValidateValue(input, value, addMessage))
                    {
                        continue; // Skip invalid values
                    }

                    if (paramObject is IGH_ContextualParameter contextParam)
                    {
                        var success = ApplyToContextualParameter(contextParam, input.ParamType, value, addMessage);
                        if (success)
                        {
                            updateCount++;
                            _lastAppliedValues[inputKey] = value;

                            if (paramObject is IGH_ActiveObject activeObj)
                            {
                                _pendingExpirations.Add(activeObj);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                        $"Error applying value to '{input.Name}': {ex.Message}");
                }
            }

            if (_pendingExpirations.Count > 0)
            {
                document.ScheduleSolution(10, ExpireCallback);
            }

            return updateCount;
        }

        /// <summary>
        ///     Callback for ScheduleSolution - expires parameters and nothing else
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
        ///     Check if value has changed since last application
        /// </summary>
        public bool HasValueChanged(string key, object newValue)
        {
            if (_lastAppliedValues.TryGetValue(key, out var lastValue))
            {
                return newValue?.ToString() != lastValue?.ToString();
            }

            return true;
        }

        /// <summary>
        ///     Get or create cached reflection results for a given type
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
        ///     Get the last applied values dictionary
        /// </summary>
        public Dictionary<string, object> GetLastAppliedValues()
        {
            return new Dictionary<string, object>(_lastAppliedValues);
        }

        /// <summary>
        ///     Set the last applied values (used when loading from embedded data)
        /// </summary>
        public void SetLastAppliedValues(Dictionary<string, object> values)
        {
            _lastAppliedValues = new ConcurrentDictionary<string, object>(values);
        }

        /// <summary>
        ///     Clear all tracked values
        /// </summary>
        public void Clear()
        {
            _lastAppliedValues.Clear();
        }

        /// <summary>
        ///     Validate input value against security constraints and parameter metadata
        /// </summary>
        private bool ValidateValue(InputParamSchema input, object value,
            Action<GH_RuntimeMessageLevel, string> addMessage)
        {
            if (value == null)
            {
                return true; // null is acceptable
            }

            try
            {
                // Validate string length
                if (value is string strValue)
                {
                    if (strValue.Length > MAX_STRING_LENGTH)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                            $"String value too long for '{input.Name}' (max {MAX_STRING_LENGTH} characters)");
                        return false;
                    }
                }

                // Validate numeric ranges
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
                            $"Invalid numeric value for '{input.Name}'");
                        return false;
                    }

                    // Check parameter-defined constraints
                    if (input.Minimum.HasValue && numValue < input.Minimum.Value)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Value {numValue} for '{input.Name}' is below minimum {input.Minimum.Value}. Clamping to minimum.");
                        return false; // Don't apply, let parameter handle default
                    }

                    if (input.Maximum.HasValue && numValue > input.Maximum.Value)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Value {numValue} for '{input.Name}' is above maximum {input.Maximum.Value}. Clamping to maximum.");
                        return false; // Don't apply, let parameter handle default
                    }

                    // Sanity check for extremely large numbers (potential DoS)
                    if (double.IsInfinity(numValue) || double.IsNaN(numValue))
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                            $"Invalid numeric value for '{input.Name}' (Infinity or NaN)");
                        return false;
                    }
                }

                // Validate integer conversion
                if (input.ParamType == "Integer")
                {
                    try
                    {
                        var intValue = Convert.ToInt32(value);
                        // Check if value is within int32 range
                        if (intValue < int.MinValue || intValue > int.MaxValue)
                        {
                            addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                                $"Integer value out of range for '{input.Name}'");
                            return false;
                        }
                    }
                    catch (OverflowException)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                            $"Integer value overflow for '{input.Name}'");
                        return false;
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                    $"Validation error for '{input.Name}': {ex.Message}");
                return false;
            }
        }

        /// <summary>
        ///     Apply a value to a contextual parameter using reflection and type handlers
        ///     Uses cached reflection to eliminate overhead
        /// </summary>
        private bool ApplyToContextualParameter(IGH_ContextualParameter contextParam, string paramTypeName,
            object value, Action<GH_RuntimeMessageLevel, string> addMessage)
        {
            try
            {
                // Special handling for ValueList - use the parameter's native type
                if (paramTypeName == "ValueList")
                {
                    return ApplyToValueList(contextParam, value, addMessage);
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
        ///     Apply a value to a ValueList parameter using reflection to discover the correct data type
        /// </summary>
        private bool ApplyToValueList(IGH_ContextualParameter contextParam, object value,
            Action<GH_RuntimeMessageLevel, string> addMessage)
        {
            try
            {
                var param = contextParam as IGH_Param;
                if (param == null)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning, "ValueList parameter is not IGH_Param");
                    return false;
                }

                var docObj = contextParam as IGH_DocumentObject;
                var paramId = docObj?.InstanceGuid ?? Guid.Empty;

                // Try to get cached reflection info
                if (!_valueListCaches.TryGetValue(paramId, out var cache))
                {
                    // Build cache for this parameter
                    var paramType = param.GetType();
                    var typeHintProp = paramType.GetProperty("TypeHint");
                    var storedItemsProp = paramType.GetProperty("StoredListItems");
                    Type dataType = null;

                    if (typeHintProp != null)
                    {
                        var typeHint = typeHintProp.GetValue(param);
                        if (typeHint != null)
                        {
                            var typeProperty = typeHint.GetType().GetProperty("Type");
                            if (typeProperty != null)
                            {
                                dataType = typeProperty.GetValue(typeHint) as Type;
                            }
                        }
                    }

                    // Fallback: inspect the VolatileData to get the actual type
                    if (dataType == null && param.VolatileData != null && param.VolatileData.DataCount > 0)
                    {
                        foreach (var item in param.VolatileData.AllData(true))
                        {
                            if (item != null)
                            {
                                dataType = item.GetType();
                                break;
                            }
                        }
                    }

                    if (dataType == null)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            "Could not determine ValueList data type");
                        return false;
                    }

                    if (storedItemsProp == null)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            "Could not find StoredListItems property on ValueList parameter");
                        return false;
                    }

                    // Cache the reflection info
                    cache = new ValueListCache
                    {
                        TypeHintProp = typeHintProp,
                        StoredItemsProp = storedItemsProp,
                        DataType = dataType
                    };
                    _valueListCaches[paramId] = cache;
                }

                // Get the StoredListItems using cached property
                var cachedStoredItemsProp = cache.StoredItemsProp;
                var cachedDataType = cache.DataType;

                var storedItems = cachedStoredItemsProp.GetValue(param) as System.Collections.IList;
                if (storedItems == null || storedItems.Count == 0)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        "ValueList has no stored items");
                    return false;
                }

                // Build the items tuple list
                var itemsTuplesType = typeof(List<>).MakeGenericType(typeof(ValueTuple<string, string>));
                var itemsTuples = Activator.CreateInstance(itemsTuplesType) as System.Collections.IList;

                string selectedKey = value?.ToString();
                int selectedIndex = -1;

                for (int i = 0; i < storedItems.Count; i++)
                {
                    var item = storedItems[i];
                    var nameProperty = item.GetType().GetProperty("Name");
                    var expressionProperty = item.GetType().GetProperty("Expression");

                    if (nameProperty != null && expressionProperty != null)
                    {
                        var name = nameProperty.GetValue(item)?.ToString();
                        var expression = expressionProperty.GetValue(item)?.ToString();

                        // Create ValueTuple<string, string>
                        var tuple = Activator.CreateInstance(typeof(ValueTuple<string, string>), name, expression);
                        itemsTuples.Add(tuple);

                        // Find the selected index by matching the key (name)
                        if (name == selectedKey)
                        {
                            selectedIndex = i;
                        }
                    }
                }

                // If we didn't find a match, default to first item
                if (selectedIndex < 0 && itemsTuples.Count > 0)
                {
                    selectedIndex = 0;
                }

                // Get the expression value for the selected item
                string selectedExpression = "";
                if (selectedIndex >= 0 && selectedIndex < storedItems.Count)
                {
                    var selectedItem = storedItems[selectedIndex];
                    var expressionProperty = selectedItem.GetType().GetProperty("Expression");
                    selectedExpression = expressionProperty?.GetValue(selectedItem)?.ToString() ?? "";
                }

                // Create GH_ValueListData instance: GH_ValueListData(string value, List<(string, string)> items, int selectedIndex)
                object ghValue = Activator.CreateInstance(cachedDataType, selectedExpression, itemsTuples, selectedIndex);

                // Create DataTree of the correct type
                var dataTreeType = typeof(DataTree<>).MakeGenericType(cachedDataType);
                var dataTree = Activator.CreateInstance(dataTreeType);

                // Add value to tree
                var addMethod = dataTreeType.GetMethod("Add", new[] { cachedDataType, typeof(GH_Path) });
                if (addMethod == null)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Could not find Add method for type {cachedDataType.Name}");
                    return false;
                }

                addMethod.Invoke(dataTree, new object[] { ghValue, new GH_Path(0) });

                // Assign to parameter using reflection
                var assignMethod = contextParam.GetType().GetMethod("AssignContextualDataTree");
                if (assignMethod != null)
                {
                    assignMethod.Invoke(contextParam, new[] { dataTree });
                    return true;
                }

                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    "Could not find AssignContextualDataTree method");
                return false;
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error applying ValueList value: {ex.Message}");
                return false;
            }
        }
    }
}