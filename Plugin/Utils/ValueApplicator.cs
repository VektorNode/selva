using System;
using System.Collections.Generic;
using ComputeBuilder.Plugin.Models;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

namespace ComputeBuilder.Plugin.Utils
{
    /// <summary>
    ///     Handles applying values from web UI to Grasshopper parameters
    /// </summary>
    public class ValueApplicator
    {
        private static readonly Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)> TypeHandlers =
            new Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)>()
            {
                { "Number", (typeof(GH_Number), val => new GH_Number(Convert.ToDouble(val))) },
                { "Integer", (typeof(GH_Integer), val => new GH_Integer(Convert.ToInt32(val))) },
                { "Text", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
                { "Boolean", (typeof(GH_Boolean), val => new GH_Boolean(Convert.ToBoolean(val))) }
            };

        private readonly List<IGH_ActiveObject> _pendingExpirations = new List<IGH_ActiveObject>();

        private Dictionary<string, object> _lastAppliedValues = new Dictionary<string, object>();

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

            // Schedule solution using recommended pattern
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
            _lastAppliedValues = new Dictionary<string, object>(values);
        }

        /// <summary>
        ///     Clear all tracked values
        /// </summary>
        public void Clear()
        {
            _lastAppliedValues.Clear();
        }

        /// <summary>
        ///     Apply a value to a contextual parameter using reflection and type handlers
        /// </summary>
        private bool ApplyToContextualParameter(IGH_ContextualParameter contextParam, string paramTypeName,
            object value, Action<GH_RuntimeMessageLevel, string> addMessage)
        {
            try
            {
                if (!TypeHandlers.TryGetValue(paramTypeName, out var handler))
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Unsupported parameter type: {paramTypeName}");
                    return false;
                }

                var ghValue = handler.Converter(value);

                // Create DataTree using reflection (since we don't know the type at compile time)
                var dataTreeType = typeof(DataTree<>).MakeGenericType(handler.GhType);
                var dataTree = Activator.CreateInstance(dataTreeType);

                // Add value to tree - specify parameter types to avoid ambiguity
                var addMethod = dataTreeType.GetMethod("Add", new[] { handler.GhType, typeof(GH_Path) });
                if (addMethod == null)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Could not find Add method for type {handler.GhType.Name}");
                    return false;
                }

                addMethod.Invoke(dataTree, new object[] { ghValue, new GH_Path(0) });

                // Assign to parameter using reflection
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
    }
}