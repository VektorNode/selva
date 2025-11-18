using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using ComputeBuilder.Models;
using Grasshopper.GUI;
using Grasshopper.Kernel.Special;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Manages parameter scanning and schema validation
    /// </summary>
    public class SchemaManager
    {
        private readonly string _sessionId;

        public SchemaManager(string sessionId)
        {
            _sessionId = sessionId;
        }

        /// <summary>
        /// Scan document and return available parameters
        /// </summary>
        public AvailableParameters ScanParameters(GH_Document document)
        {
            // Scan for all contextual parameters and outputs
            var allParams = document.Objects
                .OfType<IGH_ContextualParameter>()
                .ToList();

            var contextOutputs = document.Objects
                .Where(o =>
                {
                    var name = o?.GetType()?.Name;
                    return string.Equals(name, "ContextPrintComponent", StringComparison.Ordinal)
                           || string.Equals(name, "ContextBakeComponent", StringComparison.Ordinal);
                })
                .ToList();

            // Build available parameters list
            var availableParameters = new AvailableParameters
            {
                SessionId = _sessionId,
                Timestamp = DateTime.UtcNow,
                Parameters = new List<AvailableParameter>()
            };

            // Add input parameters
            foreach (var param in allParams)
            {
                var docObj = param as IGH_DocumentObject;
                if (docObj == null) continue;

                var ghParam = param as IGH_Param;
                var availableParam = new AvailableParameter
                {
                    Id = docObj.InstanceGuid,
                    Name = docObj.Name,
                    Nickname = docObj.NickName,
                    Description = docObj.Description ?? "",
                    Category = "input",
                    ParamType = GetParameterTypeName(param),
                    Default = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable(), //TODO: properly handle tree inputs (not a priority for now)
                    AtLeast = param.AtLeast,
                    AtMost = param.AtMost
                };

                // Extract TreeAccess property via reflection
                try
                {
                    var treeAccessProp = param.GetType().GetProperty("TreeAccess");
                    if (treeAccessProp != null)
                    {
                        availableParam.TreeAccess = Convert.ToBoolean(treeAccessProp.GetValue(param, null));
                    }
                }
                catch
                {
                    // Ignore reflection errors
                }

                //If source is a slider extract its properties
                if (ghParam.SourceCount == 1 && ghParam.Sources[0] is GH_NumberSlider slider)
                {
                    availableParam.Maximum = slider.Slider.Maximum;
                    availableParam.Minimum = slider.Slider.Minimum;
                    availableParam.StepSize = slider.Slider.Epsilon;

                }

                availableParameters.Parameters.Add(availableParam);
            }

            // Add output components
            foreach (var output in contextOutputs)
            {
                if (output == null) continue;

                var component = output as GH_Component;
                IGH_Param outputParam = component?.Params.Input.FirstOrDefault();

                availableParameters.Parameters.Add(new AvailableParameter
                {
                    Id = output.InstanceGuid,
                    Name = output.Name,
                    Nickname = output.NickName,
                    Description = output.Description ?? "",
                    Category = "output",
                    ParamType = outputParam != null ? GetParameterTypeNameFromParam(outputParam) : "Generic",
                    Default = outputParam?.VolatileData.AllData(false).FirstOrDefault()?.ScriptVariable()
                });
            }

            return availableParameters;
        }

        /// <summary>
        /// Validate no duplicate parameter names
        /// </summary>
        public List<string> ValidateDuplicates(AvailableParameters parameters)
        {
            return parameters.Parameters
                .GroupBy(p => p.Nickname)
                .Where(g => g.Count() > 1)
                .Select(g => g.Key)
                .ToList();
        }

        /// <summary>
        /// Get parameter type name from contextual parameter
        /// </summary>
        private string GetParameterTypeName(IGH_ContextualParameter contextParam)
        {
            if (contextParam is IGH_Param param)
            {
                return GetParameterTypeNameFromParam(param);
            }
            return "Unknown";
        }

        /// <summary>
        /// Map Grasshopper parameter type to Compute-compatible type name using dictionary
        /// </summary>
        private string GetParameterTypeNameFromParam(IGH_Param param)
        {
            if (param == null) return "Unknown";

            var typeName = param.GetType().Name;

            // Dictionary-based type mapping for performance
            var typeKeywords = new Dictionary<string, string>
            {
                { "Number", "Number" },
                { "Slider", "Number" },
                { "Integer", "Integer" },
                { "Boolean", "Boolean" },
                { "Toggle", "Boolean" },
                { "String", "Text" },
                { "Text", "Text" },
                { "Panel", "Text" },
                { "Point", "Point" },
                { "Vector", "Vector" },
                { "Plane", "Plane" },
                { "Line", "Line" },
                { "Circle", "Circle" },
                { "Rectangle", "Rectangle" },
                { "Box", "Box" },
                { "Curve", "Curve" },
                { "Surface", "Surface" },
                { "Brep", "Brep" },
                { "Mesh", "Mesh" },
                { "SubD", "SubD" },
                { "Geometry", "Geometry" }
            };

            // Try to find matching keyword in type name
            foreach (var kvp in typeKeywords)
            {
                if (typeName.Contains(kvp.Key))
                    return kvp.Value;
            }

            return "Generic";
        }
    }
}
