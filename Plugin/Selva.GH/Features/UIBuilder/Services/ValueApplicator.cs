using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq.Expressions;
using System.Reflection;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

public class ValueApplicator
{
    private const int MAX_STRING_LENGTH = AppConfig.ValueLimits.MaxStringLength;

    private static readonly Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)> TypeHandlers =
        new Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)>
        {
            { "number", (typeof(GH_Number), val => new GH_Number(Convert.ToDouble(val, CultureInfo.InvariantCulture))) },
            { "integer", (typeof(GH_Integer), val => new GH_Integer(Convert.ToInt32(val, CultureInfo.InvariantCulture))) },
            { "text", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
            { "boolean", (typeof(GH_Boolean), val => new GH_Boolean(Convert.ToBoolean(val))) },
            { "valueList", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
            { "dynamicValueList", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
            {
                "file", (typeof(FileInputGoo), val =>
                {
                    var json = val?.ToString() ?? "";
                    try
                    {
                        var fileData = JsonConvert.DeserializeObject<FileInputData>(json);
                        return new FileInputGoo(fileData);
                    }
                    catch
                    {
                        return new FileInputGoo();
                    }
                })
            },
            { "color", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) }
        };


    private static readonly ConcurrentDictionary<Type, ReflectionCache> _reflectionCache =
        new ConcurrentDictionary<Type, ReflectionCache>();

    private ConcurrentDictionary<string, object> _lastAppliedValues = new ConcurrentDictionary<string, object>();

    /// <returns>Number of parameters updated</returns>
    public int ApplyValuesAndSchedule(GH_Document document, UISchema schema, Dictionary<string, object> values,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        var updateCount = 0;
        var pendingExpirations = new HashSet<IGH_ActiveObject>();

        foreach (var input in schema.Inputs)
        {
            try
            {
                var inputKey = input.Id.ToString();

                // Check the payload before the expensive FindObject lookup.
                if (!values.TryGetValue(inputKey, out var value))
                {
                    continue;
                }

                var paramObject = document.FindObject(input.Id, false);
                if (paramObject == null)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Parameter '{input.Nickname}' not found in document");
                    continue;
                }

                // Skip dedup for file and dynamicValueList params:
                //  - file: the same file can be re-submitted after the user clears the GH
                //    parameter. ClearContextualData doesn't touch _lastAppliedValues, so
                //    HasValueChanged would wrongly say nothing changed.
                //  - dynamicValueList: options are recomputed every solve, so the same string
                //    value can map to a different option, or get re-sent unchanged when the UI
                //    reconciles a vanished selection. Deduping here would skip the re-apply and
                //    freeze the output on the previous solve's value.
                var skipDedup = input.ParamType == "file" || input.ParamType == "dynamicValueList";
                if (!skipDedup && !HasValueChanged(inputKey, value))
                {
                    continue;
                }

                if (!ValidateValue(input, value, addMessage))
                {
                    continue;
                }

                if (paramObject is IGH_ContextualParameter contextParam)
                {
                    var success =
                        ApplyToContextualParameter(contextParam, input.ParamType, value, addMessage,
                            pendingExpirations);
                    if (success)
                    {
                        updateCount++;
                        _lastAppliedValues[inputKey] = value;

                        if (paramObject is IGH_ActiveObject activeObj)
                        {
                            pendingExpirations.Add(activeObj);
                        }
                    }
                }
                else if (input.ParamType == "file")
                {
                    var success = ApplyToFileParameter(paramObject, value, addMessage, pendingExpirations);
                    if (success)
                    {
                        updateCount++;
                        _lastAppliedValues[inputKey] = value;

                        if (paramObject is IGH_ActiveObject activeObj)
                        {
                            pendingExpirations.Add(activeObj);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                    $"Error applying value to '{input.Nickname}': {ex.Message}");
            }
        }

        if (pendingExpirations.Count > 0)
        {
            var toExpire = pendingExpirations;
            document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc =>
            {
                foreach (var obj in toExpire)
                {
                    obj.ExpireSolution(false);
                }
            });
        }

        return updateCount;
    }

    public bool HasValueChanged(string key, object newValue)
    {
        if (_lastAppliedValues.TryGetValue(key, out var lastValue))
        {
            return newValue?.ToString() != lastValue?.ToString();
        }

        return true;
    }

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

    public Dictionary<string, object> GetLastAppliedValues()
    {
        return new Dictionary<string, object>(_lastAppliedValues);
    }

    public void SetLastAppliedValues(Dictionary<string, object> values)
    {
        _lastAppliedValues = new ConcurrentDictionary<string, object>(values);
    }

    public void RemoveValues(IEnumerable<string> keys)
    {
        if (keys == null)
        {
            return;
        }

        foreach (var key in keys)
        {
            _lastAppliedValues.TryRemove(key, out _);
        }
    }

    public void Clear()
    {
        _lastAppliedValues.Clear();
    }

    // Min/max range constraints are enforced at the UI level; this only guards against
    // oversized strings and unusable numeric values.
    private bool ValidateValue(SchemaInput input, object value,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        if (value == null)
        {
            return true;
        }

        try
        {
            if (value is string strValue && input.ParamType != "file")
            {
                if (strValue.Length > MAX_STRING_LENGTH)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                        $"String value too long for '{input.Nickname}' (max {MAX_STRING_LENGTH} characters)");
                    return false;
                }
            }

            if (input.ParamType == "number" || input.ParamType == "integer")
            {
                double numValue;
                try
                {
                    numValue = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                }
                catch (Exception)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                        $"Invalid numeric value for '{input.Nickname}'");
                    return false;
                }

                if (double.IsInfinity(numValue) || double.IsNaN(numValue))
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                        $"Invalid numeric value for '{input.Nickname}' (Infinity or NaN)");
                    return false;
                }
            }

            if (input.ParamType == "integer")
            {
                try
                {
                    Convert.ToInt32(value, CultureInfo.InvariantCulture);
                }
                catch (OverflowException)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                        $"Integer value overflow for '{input.Nickname}'");
                    return false;
                }
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

    private bool ApplyToContextualParameter(IGH_ContextualParameter contextParam, string paramTypeName,
        object value, Action<GH_RuntimeMessageLevel, string> addMessage, HashSet<IGH_ActiveObject> pendingExpirations)
    {
        try
        {
            // Static and dynamic value lists share the same selection-by-name flow.
            if (paramTypeName == "valueList" || paramTypeName == "dynamicValueList")
            {
                return ApplyToValueList(contextParam, value, addMessage, pendingExpirations);
            }

            // File params go through ApplyToFileParameter: AssignContextualDataTree can't carry a FileInputGoo.
            if (paramTypeName == "file")
            {
                return ApplyToFileParameter(contextParam, value, addMessage, pendingExpirations);
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

    private bool ApplyToValueList(IGH_ContextualParameter contextParam, object value,
        Action<GH_RuntimeMessageLevel, string> addMessage, HashSet<IGH_ActiveObject> pendingExpirations)
    {
        try
        {
            // Multi-select (checklist) values arrive as arrays: dispatch to SelectItemsByName.
            var multiValues = ExtractMultiValues(value);
            if (multiValues != null)
            {
                var multiMethod = contextParam.GetType().GetMethod("SelectItemsByName");
                if (multiMethod != null)
                {
                    var multiResult = multiMethod.Invoke(contextParam, new object[] { multiValues });
                    if (multiResult is bool multiSuccess && multiSuccess)
                    {
                        TrackConnectedValueListExpire(contextParam, pendingExpirations);
                        return true;
                    }

                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        "No checklist items matched the requested values");
                    return false;
                }
            }

            var selectedKey = value?.ToString();
            if (string.IsNullOrEmpty(selectedKey))
            {
                // Empty is a valid state, not an error: an unchecked checklist, or a dynamic value
                // list before its first solve has produced options. Nothing to apply: no-op.
                return true;
            }

            var selectMethod = contextParam.GetType().GetMethod("SelectItemByName");
            if (selectMethod != null)
            {
                var result = selectMethod.Invoke(contextParam, new object[] { selectedKey });
                if (result is bool success && success)
                {
                    TrackConnectedValueListExpire(contextParam, pendingExpirations);
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
    ///     Returns a multi-select payload (JArray, IEnumerable of strings, etc.) as a List&lt;string&gt;,
    ///     or null if it's a single value so the caller falls back to the single-value path.
    /// </summary>
    private static List<string> ExtractMultiValues(object value)
    {
        if (value == null || value is string)
        {
            return null;
        }

        if (value is JArray jarray)
        {
            var list = new List<string>();
            foreach (var token in jarray)
            {
                if (token != null && token.Type != JTokenType.Null)
                {
                    list.Add(token.ToString());
                }
            }

            return list.Count > 0 ? list : null;
        }

        if (value is IEnumerable enumerable)
        {
            var list = new List<string>();
            foreach (var item in enumerable)
            {
                if (item != null)
                {
                    list.Add(item.ToString());
                }
            }

            return list.Count > 0 ? list : null;
        }

        return null;
    }

    private static void TrackConnectedValueListExpire(
        IGH_ContextualParameter contextParam, HashSet<IGH_ActiveObject> pendingExpirations)
    {
        var connectedVLProperty = contextParam.GetType().GetProperty("ConnectedValueList",
            BindingFlags.NonPublic | BindingFlags.Instance);
        if (connectedVLProperty?.GetValue(contextParam) is IGH_ActiveObject connectedVL)
        {
            pendingExpirations.Add(connectedVL);
        }
    }

    /// <summary>
    ///     Applies a file value to a regular (non-contextual) parameter, e.g. File_Selector.
    ///     Value can be a JSON string, JObject, dictionary, or FileInputData instance.
    /// </summary>
    private bool ApplyToFileParameter(object paramObject, object value,
        Action<GH_RuntimeMessageLevel, string> addMessage, HashSet<IGH_ActiveObject> pendingExpirations)
    {
        try
        {
            if (paramObject is not IGH_Param param)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning, "File parameter is not an IGH_Param");
                return false;
            }

            FileInputData fileData = null;

            try
            {
                if (value is FileInputData existingData)
                {
                    fileData = existingData;
                }
                else if (value is JObject jObject)
                {
                    fileData = jObject.ToObject<FileInputData>();
                }
                else if (value is Dictionary<string, object> dict)
                {
                    fileData = JsonConvert.DeserializeObject<FileInputData>(
                        JsonConvert.SerializeObject(dict));
                }
                else
                {
                    var strValue = value?.ToString() ?? "";

                    if (strValue.TrimStart().StartsWith("{"))
                    {
                        fileData = JsonConvert.DeserializeObject<FileInputData>(strValue);
                    }
                    else if (strValue.StartsWith("http://") || strValue.StartsWith("https://"))
                    {
                        fileData = FileInputData.FromUrl(strValue);
                    }
                    else if (!string.IsNullOrEmpty(strValue))
                    {
                        fileData = FileInputData.FromPath(strValue);
                    }
                    else
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            "File data is empty");
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

            var fileGoo = new FileInputGoo(fileData);

            // AssignContextualData works for both IGH_Param and GH_Component contextual params.
            if (paramObject is IGH_ContextualParameter)
            {
                var assignContextualDataMethod = paramObject.GetType().GetMethod("AssignContextualData",
                    new[] { typeof(IEnumerable) });
                if (assignContextualDataMethod != null)
                {
                    try
                    {
                        var dataList = new List<object> { fileGoo };
                        assignContextualDataMethod.Invoke(paramObject, new object[] { dataList });

                        if (paramObject is IGH_ActiveObject activeObj)
                        {
                            pendingExpirations.Add(activeObj);
                        }

                        return true;
                    }
                    catch (Exception ex)
                    {
                        Logger.Log($"[ValueApplicator] AssignContextualData failed: {ex.Message}");
                    }
                }
            }

            // Fall back to the standard data tree methods, tried in order.
            var dataTree = new DataTree<FileInputGoo>();
            dataTree.Add(fileGoo, new GH_Path(0));

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
                    Logger.Log($"[ValueApplicator] AddVolatileDataTree failed: {ex.Message}");
                }
            }

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
                    Logger.Log($"[ValueApplicator] AddVolatileData failed: {ex.Message}");
                }
            }

            addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                "Could not find any method to assign file data to parameter (tried: AssignContextualData, AddVolatileDataTree, AddVolatileData)");
            return false;
        }
        catch (Exception ex)
        {
            addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                $"Error applying file value: {ex.Message}");
            return false;
        }
    }

    private class ReflectionCache
    {
        public MethodInfo AddMethod;
        public Func<object> CreateInstance;
        public Type DataTreeType;
    }
}
