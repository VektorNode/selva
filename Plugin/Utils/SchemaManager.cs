using System;
using System.Collections.Generic;
using System.Linq;
using ComputeBuilder.Models;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace ComputeBuilder.Utils
{
    /// <summary>
    ///     Manages parameter scanning and schema validation
    /// </summary>
    public class SchemaManager
    {
        private readonly string _sessionId;

        public SchemaManager(string sessionId)
        {
            _sessionId = sessionId;
        }

        /// <summary>
        ///     Scan document and return available parameters
        /// </summary>
        public AvailableParameters ScanParameters(GH_Document document)
        {
            // Scan for all contextual parameters and outputs
            var allParams = document.Objects
                .OfType<IGH_ContextualParameter>()
                .ToList();

            var contextOutputs = document.Objects
                .Where(ParameterTypeHelper.IsContextOutputComponent)
                .ToList();

            var availableParameters = new AvailableParameters
            {
                SessionId = _sessionId,
                Timestamp = DateTime.UtcNow,
                Parameters = new List<AvailableParameter>()
            };

            foreach (var param in allParams)
            {
                var docObj = param as IGH_DocumentObject;
                if (docObj == null)
                {
                    continue;
                }

                var ghParam = param as IGH_Param;
                var availableParam = new AvailableParameter
                {
                    Id = docObj.InstanceGuid,
                    Name = docObj.Name,
                    Nickname = docObj.NickName,
                    Description = docObj.Description ?? "",
                    Category = "input",
                    ParamType = GetParameterTypeName(param),
                    Default = ghParam?.VolatileData.AllData(true).FirstOrDefault()
                        ?.ScriptVariable(), //TODO: properly handle tree inputs (not a priority for now)
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
                    // ignored
                }

                ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, availableParam);
                availableParameters.Parameters.Add(availableParam);
            }

            foreach (var output in contextOutputs)
            {
                if (output == null)
                {
                    continue;
                }

                var component = output as GH_Component;
                var outputParam = component?.Params.Input.FirstOrDefault();

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
        ///     Validate no duplicate parameter names
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
        ///     Validate schema against current document - removes references to missing parameters
        ///     Wrapper for ValidateSchemaAndTrackChanges without tracking
        /// </summary>
        public UISchema ValidateSchema(UISchema schema, GH_Document document)
        {
            return ValidateSchemaAndTrackChanges(schema, document, false).Schema;
        }

        /// <summary>
        ///     Validate schema and optionally track what changed (removed parameters)
        /// </summary>
        public (UISchema Schema, List<Guid> RemovedIds) ValidateSchemaAndTrackChanges(
            UISchema schema,
            GH_Document document,
            bool trackChanges = true)
        {
            if (schema == null)
            {
                return (null, new List<Guid>());
            }

            var removedIds = trackChanges ? new List<Guid>() : null;

            var inputsToRemove = schema.Inputs.Where(input =>
            {
                var paramObject = document.FindObject(input.Id, false);
                return paramObject == null;
            }).ToList();

            if (trackChanges)
            {
                removedIds.AddRange(inputsToRemove.Select(i => i.Id));
            }

            schema.Inputs.RemoveAll(input => inputsToRemove.Contains(input));

            var outputsToRemove = schema.Outputs.Where(output =>
            {
                var paramObject = document.FindObject(output.Id, false);
                return paramObject == null;
            }).ToList();

            if (trackChanges)
            {
                removedIds.AddRange(outputsToRemove.Select(o => o.Id));
            }

            schema.Outputs.RemoveAll(output => outputsToRemove.Contains(output));

            if (schema.Layout.Tabs != null)
            {
                foreach (var tab in schema.Layout.Tabs)
                {
                    foreach (var group in tab.Groups)
                    {
                        group.Items.RemoveAll(item =>
                        {
                            var paramObject = document.FindObject(item.ParamId, false);
                            return paramObject == null;
                        });
                    }

                    tab.Groups.RemoveAll(g => g.Items.Count == 0);
                }

                schema.Layout.Tabs.RemoveAll(t => t.Groups.Count == 0);
            }

            if (schema.Layout.Items != null)
            {
                schema.Layout.Items.RemoveAll(item =>
                {
                    var paramObject = document.FindObject(item.ParamId, false);
                    return paramObject == null;
                });
            }

            return (schema, removedIds ?? new List<Guid>());
        }

        /// <summary>
        ///     Get parameter type name from contextual parameter
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
        ///     Map Grasshopper parameter type to Compute-compatible type name using dictionary
        /// </summary>
        private string GetParameterTypeNameFromParam(IGH_Param param)
        {
            if (param == null)
            {
                return "Unknown";
            }

            var typeName = param.GetType().Name;

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
                {
                    return kvp.Value;
                }
            }

            return "Generic";
        }
    }
}