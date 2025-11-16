using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Grasshopper.Kernel.Data;
using ComputeBuilder.Models;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Handles applying values from web UI to Grasshopper parameters
    /// </summary>
    public class ValueApplicator
    {
        private Dictionary<string, object> _lastAppliedValues = new Dictionary<string, object>();

        // Type mapping dictionary for value conversion
        private static readonly Dictionary<string, (Type GhType, Func<object, IGH_Goo> Converter)> TypeHandlers =
            new Dictionary<string, (Type, Func<object, IGH_Goo>)>
            {
                { "Number", (typeof(GH_Number), val => new GH_Number(Convert.ToDouble(val))) },
                { "Integer", (typeof(GH_Integer), val => new GH_Integer(Convert.ToInt32(val))) },
                { "Text", (typeof(GH_String), val => new GH_String(val?.ToString() ?? "")) },
                { "Boolean", (typeof(GH_Boolean), val => new GH_Boolean(Convert.ToBoolean(val))) }
            };

        /// <summary>
        /// Apply values from web UI to Grasshopper parameters
        /// </summary>
        /// <returns>Number of parameters updated</returns>
        public int ApplyValues(GH_Document document, UISchema schema, Dictionary<string, object> values, Action<GH_RuntimeMessageLevel, string> addMessage)
        {
            int updateCount = 0;
            List<IGH_ActiveObject> expiredObjects = new List<IGH_ActiveObject>();

            foreach (var input in schema.Inputs)
            {
                try
                {
                    var paramObject = document.FindObject(input.GrasshopperId, false);
                    if (paramObject == null)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Parameter '{input.Name}' not found in document");
                        continue;
                    }

                    var inputKey = input.GrasshopperId.ToString();
                    if (!values.TryGetValue(inputKey, out var value))
                        continue;

                    // Check if the value has changed
                    if (!HasValueChanged(inputKey, value))
                        continue;

                    if (paramObject is IGH_ContextualParameter contextParam)
                    {
                        bool success = ApplyToContextualParameter(contextParam, input.ParamType, value, addMessage);
                        if (success)
                        {
                            updateCount++;
                            _lastAppliedValues[inputKey] = value;

                            // Expire this parameter to trigger recomputation
                            if (paramObject is IGH_ActiveObject activeObj)
                            {
                                expiredObjects.Add(activeObj);
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

            // Expire all updated parameters at once
            if (expiredObjects.Count > 0)
            {
                foreach (var obj in expiredObjects)
                {
                    obj.ExpireSolution(false); // false = don't recompute immediately, batch them
                }
            }

            return updateCount;
        }

        /// <summary>
        /// Check if value has changed since last application
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
        /// Get the last applied values dictionary
        /// </summary>
        public Dictionary<string, object> GetLastAppliedValues()
        {
            return new Dictionary<string, object>(_lastAppliedValues);
        }

        /// <summary>
        /// Set the last applied values (used when loading from embedded data)
        /// </summary>
        public void SetLastAppliedValues(Dictionary<string, object> values)
        {
            _lastAppliedValues = new Dictionary<string, object>(values);
        }

        /// <summary>
        /// Clear all tracked values
        /// </summary>
        public void Clear()
        {
            _lastAppliedValues.Clear();
        }

        /// <summary>
        /// Apply a value to a contextual parameter using reflection and type handlers
        /// </summary>
        private bool ApplyToContextualParameter(IGH_ContextualParameter contextParam, string paramTypeName, object value, Action<GH_RuntimeMessageLevel, string> addMessage)
        {
            try
            {
                if (!TypeHandlers.TryGetValue(paramTypeName, out var handler))
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Unsupported parameter type: {paramTypeName}");
                    return false;
                }

                // Convert value using the handler
                var ghValue = handler.Converter(value);

                // Create DataTree using reflection (since we don't know the type at compile time)
                var dataTreeType = typeof(Grasshopper.DataTree<>).MakeGenericType(handler.GhType);
                var dataTree = Activator.CreateInstance(dataTreeType);

                // Add value to tree - specify parameter types to avoid ambiguity
                var addMethod = dataTreeType.GetMethod("Add", new Type[] { handler.GhType, typeof(GH_Path) });
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
                    method.Invoke(contextParam, new object[] { dataTree });
                    return true;
                }
                else
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Could not find AssignContextualDataTree method");
                    return false;
                }
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
