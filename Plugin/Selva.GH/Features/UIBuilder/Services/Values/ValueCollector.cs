using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Schema.Models;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.FileIO.Services;

namespace Selva.GH.Features.UIBuilder.Services.Values;

/// <summary>
///     Handles collection and extraction of values from Grasshopper parameters and components
/// </summary>
public class ValueCollector
{
    /// <summary>
    ///     Collect current input values from all parameters in the schema
    /// </summary>
    public Dictionary<string, object> CollectInputValues(GH_Document document, UISchema schema,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var currentValues = new Dictionary<string, object>();

        if (schema?.Inputs == null || schema.Inputs.Count == 0)
        {
            return currentValues;
        }

        foreach (var input in schema.Inputs)
        {
            try
            {
                var paramObject = document.FindObject(input.Id, false);
                if (paramObject == null)
                {
                    continue;
                }

                if (paramObject is IGH_Param ghParam)
                {
                    var value = ExtractParameterValue(ghParam, input);
                    if (value != null)
                    {
                        currentValues[input.Id.ToString()] = value;
                    }
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting current value for '{input.Nickname}': {ex.Message}");
            }
        }

        return currentValues;
    }

    /// <summary>
    ///     Collect output values from all output components in the schema
    /// </summary>
    public Dictionary<string, object> CollectOutputValues(GH_Document document, UISchema schema,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var outputValues = new Dictionary<string, object>();

        if (schema?.Outputs == null || schema.Outputs.Count == 0)
        {
            return outputValues;
        }

        foreach (var output in schema.Outputs)
        {
            try
            {
                var paramObject = document.FindObject(output.Id, false);
                if (paramObject == null)
                {
                    continue;
                }

                if (paramObject is IGH_Component ghComponent)
                {
                    var value = output.Type == "chart"
                        ? ExtractChartOutput(ghComponent)
                        : ExtractComponentOutput(ghComponent);
                    if (value != null)
                    {
                        outputValues[output.Id.ToString()] = value;
                    }
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting output '{output.Nickname}': {ex.Message}");
            }
        }

        return outputValues;
    }

    /// <summary>
    ///     Collect file outputs from components that output FileData
    /// </summary>
    public Dictionary<string, object> CollectFileOutputs(GH_Document document, UISchema schema,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var fileOutputData = new Dictionary<string, object>();

        if (schema?.Outputs == null || schema.Outputs.Count == 0)
        {
            return fileOutputData;
        }

        var fileOutputs = schema.Outputs.Where(o => o.Type == "file").ToList();

        foreach (var fileOutput in fileOutputs)
        {
            try
            {
                var componentObject = document.FindObject(fileOutput.Id, false);
                if (componentObject == null)
                {
                    continue;
                }

                if (componentObject is IGH_Component component)
                {
                    var fileDataList = ExtractFileDataFromComponent(component, addMessage);
                    if (fileDataList.Count > 0)
                    {
                        fileOutputData[fileOutput.Id.ToString()] = fileDataList.Count == 1
                            ? fileDataList[0]
                            : fileDataList;
                    }
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting file output '{fileOutput.Nickname}': {ex.Message}");
            }
        }

        return fileOutputData;
    }

    /// <summary>
    ///     Collect display data from ContextBakeComponent inputs.
    ///     Returns an array of MeshBatch objects (as JSON-serializable objects).
    ///     This mirrors Rhino.Compute behavior where baking is explicit.
    /// </summary>
    public List<object> CollectDisplayData(GH_Document document,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var displayDataList = new List<object>();

        if (document == null)
        {
            return displayDataList;
        }

        var contextBakeCount = 0;
        // Find all ContextBakeComponents and extract their input data
        foreach (var docObject in document.Objects)
        {
            if (!(docObject is IGH_Component component))
            {
                continue;
            }

            if (!IsContextBakeComponent(component))
            {
                continue;
            }

            contextBakeCount++;
            Debug.WriteLine($"[ValueCollector] Found ContextBake '{component.NickName}' ({contextBakeCount})");

            try
            {
                var displayData = ExtractDisplayDataFromContextBake(component, addMessage);
                if (displayData != null)
                {
                    Debug.WriteLine($"[ValueCollector] Found display data from ContextBake '{component.NickName}'");
                    // If displayData is a list, flatten it into displayDataList
                    if (displayData is List<object> dataList)
                    {
                        displayDataList.AddRange(dataList);
                        Debug.WriteLine($"[ValueCollector] Added {dataList.Count} batches to display list");
                    }
                    else
                    {
                        displayDataList.Add(displayData);
                        Debug.WriteLine("[ValueCollector] Added 1 batch to display list");
                    }
                }
                else
                {
                    Debug.WriteLine($"[ValueCollector] ContextBake '{component.NickName}' has no display data");
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting display data from ContextBake '{component.NickName}': {ex.Message}");
                Debug.WriteLine($"[ValueCollector] Exception in ContextBake: {ex}");
            }
        }

        Debug.WriteLine(
            $"[ValueCollector] CollectDisplayData: scanned {contextBakeCount} ContextBakes, found {displayDataList.Count} display data items");
        return displayDataList;
    }

    /// <summary>
    ///     Extract display data from a ContextBakeComponent's input parameters.
    ///     Flattens all WebDisplayGoo objects from all inputs into a single list.
    /// </summary>
    private object ExtractDisplayDataFromContextBake(IGH_Component component,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        if (component?.Params?.Input == null || component.Params.Input.Count == 0)
        {
            return null;
        }

        var displayBatches = new List<object>();

        foreach (var inputParam in component.Params.Input)
        {
            if (inputParam?.VolatileData == null || inputParam.VolatileData.IsEmpty)
            {
                continue;
            }

            var allData = inputParam.VolatileData.AllData(true);
            Debug.WriteLine($"[ValueCollector] Input '{inputParam.NickName}': {allData.Count()} items");

            foreach (var gooObj in allData)
            {
                if (gooObj is WebDisplayGoo webDisplayGoo && webDisplayGoo.IsValid)
                {
                    try
                    {
                        displayBatches.Add(webDisplayGoo.Value);
                        Debug.WriteLine($"[ValueCollector] Added WebDisplayGoo batch (total: {displayBatches.Count})");
                    }
                    catch (Exception ex)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Error extracting WebDisplayGoo data from ContextBake: {ex.Message}");
                        Debug.WriteLine($"[ValueCollector] Error extracting batch: {ex}");
                    }
                }
            }
        }

        Debug.WriteLine($"[ValueCollector] ContextBake extracted {displayBatches.Count} total batches");

        if (displayBatches.Count == 0)
        {
            return null;
        }

        // Always return as list when multiple, single object when one
        return displayBatches.Count == 1 ? displayBatches[0] : displayBatches;
    }

    /// <summary>
    ///     Check if component is a ContextBakeComponent
    /// </summary>
    private static bool IsContextBakeComponent(IGH_Component component)
    {
        if (component == null)
        {
            return false;
        }

        var typeName = component.GetType()?.Name;
        return string.Equals(typeName, "ContextBakeComponent", StringComparison.Ordinal);
    }

    /// <summary>
    ///     Extract value from a parameter, handling ValueList parameters specially
    /// </summary>
    private object ExtractParameterValue(IGH_Param ghParam, SchemaInput input)
    {
        if (ghParam is GetValueListParameter valueListParam)
        {
            return ExtractValueListValue(valueListParam);
        }

        if (ghParam.SourceCount == 1)
        {
            return ExtractDataFromVolatileData(ghParam.Sources[0].VolatileData);
        }

        return null;
    }

    /// <summary>
    ///     Extract value from ValueList parameter
    /// </summary>
    private object ExtractValueListValue(GetValueListParameter valueListParam)
    {
        var valueData = valueListParam.VolatileData;
        if (valueData != null && !valueData.IsEmpty)
        {
            var allData = valueData.AllData(true).ToList();
            if (allData.Count == 1)
            {
                return ExtractValue(allData[0]);
            }

            if (allData.Count > 1)
            {
                return allData.Select(d => ExtractValue(d)).ToList();
            }
        }

        return null;
    }

    /// <summary>
    ///     Extract output value from a component's input parameters
    /// </summary>
    private object ExtractComponentOutput(IGH_Component component)
    {
        var inputParam = component.Params.Input.FirstOrDefault();
        if (inputParam?.VolatileData != null && !inputParam.VolatileData.IsEmpty)
        {
            return ExtractDataFromVolatileData(inputParam.VolatileData);
        }

        return null;
    }

    /// <summary>
    ///     Extract a PlotlyFigure JSON string from the first input of a ContextBake component.
    ///     Uses duck-typing (TypeName + CastTo string) to avoid a hard dependency on the chart assembly.
    ///     https://github.com/TheVessen/selva-canopy/blob/main/src/PlotlyFigure.cs
    /// </summary>
    private static object ExtractChartOutput(IGH_Component component)
    {
        var inputParam = component.Params.Input.FirstOrDefault();
        if (inputParam?.VolatileData == null || inputParam.VolatileData.IsEmpty)
        {
            return null;
        }

        foreach (var goo in inputParam.VolatileData.AllData(true))
        {
            if (goo == null)
            {
                continue;
            }

            // Custom goo from external assemblies arrives wrapped in GH_ObjectWrapper on generic inputs
            var inner = goo is GH_ObjectWrapper wrapper ? wrapper.Value as IGH_Goo ?? goo : goo;

            if (!string.Equals(inner.TypeName, "Plotly Figure", StringComparison.Ordinal))
            {
                continue;
            }

            var json = inner.GetType().GetMethod("ToJson")?.Invoke(inner, null) as string;
            if (!string.IsNullOrEmpty(json))
            {
                return json;
            }
        }

        return null;
    }

    /// <summary>
    ///     Extract data from IGH_Structure (handles single values and lists)
    /// </summary>
    private object ExtractDataFromVolatileData(IGH_Structure volatileData)
    {
        if (volatileData == null || volatileData.IsEmpty)
        {
            return null;
        }

        var allData = volatileData.AllData(true).ToList();
        if (allData.Count == 1)
        {
            return ExtractValue(allData[0]);
        }

        if (allData.Count > 1)
        {
            return allData.Select(d => ExtractValue(d)).ToList();
        }

        return null;
    }

    /// <summary>
    ///     Extract FileData from all inputs of a component
    /// </summary>
    private List<object> ExtractFileDataFromComponent(IGH_Component component,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        var fileDataList = new List<object>();

        foreach (var inputParam in component.Params.Input)
        {
            if (inputParam?.VolatileData == null || inputParam.VolatileData.IsEmpty)
            {
                continue;
            }

            var allData = inputParam.VolatileData.AllData(true);
            foreach (var gooObj in allData)
            {
                if (gooObj?.GetType().FullName != null &&
                    gooObj.GetType().FullName.IndexOf("FileDataGoo", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    try
                    {
                        var extractedFileData = ExtractFileDataFromGoo(gooObj);
                        if (extractedFileData != null)
                        {
                            fileDataList.Add(extractedFileData);
                        }
                    }
                    catch (Exception ex)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Error extracting FileData from Goo: {ex.Message}");
                    }
                }
            }
        }

        return fileDataList;
    }

    /// <summary>
    ///     Extract WebDisplayGoo data from a component's output parameters.
    ///     Returns the MeshBatch object only if the output is wired into a ContextBakeComponent,
    ///     mirroring the Rhino.Compute behaviour where baking is explicit.
    /// </summary>
    private object ExtractWebDisplayDataFromComponent(IGH_Component component,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        if (component?.Params?.Output == null || component.Params.Output.Count == 0)
        {
            return null;
        }

        foreach (var outputParam in component.Params.Output)
        {
            if (outputParam?.VolatileData == null || outputParam.VolatileData.IsEmpty)
            {
                continue;
            }

            var allData = outputParam.VolatileData.AllData(true);
            foreach (var gooObj in allData)
            {
                if (gooObj is WebDisplayGoo webDisplayGoo && webDisplayGoo.IsValid)
                {
                    try
                    {
                        return webDisplayGoo.Value; // one WebDisplay component = one batch
                    }
                    catch (Exception ex)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Error extracting WebDisplayGoo data: {ex.Message}");
                    }
                }
            }
        }

        return null;
    }

    /// <summary>
    ///     Extract value from IGH_Goo wrapper
    /// </summary>
    private object ExtractValue(IGH_Goo data)
    {
        if (data is GH_String ghString)
        {
            return ghString.Value;
        }

        if (data is GH_Number ghNumber)
        {
            return ghNumber.Value;
        }

        if (data is GH_Integer ghInteger)
        {
            return ghInteger.Value;
        }

        if (data is GH_Boolean ghBoolean)
        {
            return ghBoolean.Value;
        }

        // Handle FileInputGoo - return metadata only (not the full base64 file content!)
        if (data?.GetType().FullName?.IndexOf("FileInputGoo", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            try
            {
                var fileInputGooType = data.GetType();
                var valueProperty = fileInputGooType.GetProperty("Value");
                if (valueProperty != null)
                {
                    var fileInputData = valueProperty.GetValue(data);
                    if (fileInputData != null)
                    {
                        // Get the Type, FileEnding properties
                        var fileInputDataType = fileInputData.GetType();
                        var typeProperty = fileInputDataType.GetProperty("Type");
                        var fileEndingProperty = fileInputDataType.GetProperty("FileEnding");
                        var fileProperty = fileInputDataType.GetProperty("File");

                        var fileType = typeProperty?.GetValue(fileInputData)?.ToString() ?? "base64";
                        var fileEnding = fileEndingProperty?.GetValue(fileInputData)?.ToString() ?? "";
                        var fileContent = fileProperty?.GetValue(fileInputData)?.ToString() ?? "";

                        // Return metadata only - include a truncated preview of the file content
                        // This allows the frontend to know the file is set without re-sending the entire file
                        var metadata = new
                        {
                            type = fileType,
                            fileEnding,
                            file = fileContent.Length > 100 ? fileContent.Substring(0, 100) + "..." : fileContent,
                            _fileSize = fileContent.Length,
                            _isMetadata = true // Flag to indicate this is metadata only
                        };

                        return metadata;
                    }
                }
            }
            catch (Exception ex)
            {
                // Fall through to default behavior
            }
        }

        if (data.CastTo(out string strValue))
        {
            return strValue;
        }

        return data?.ToString() ?? "";
    }

    /// <summary>
    ///     Extract FileData object from FileDataGoo using direct casting
    /// </summary>
    private object ExtractFileDataFromGoo(IGH_Goo gooObj)
    {
        if (gooObj == null)
        {
            return null;
        }

        try
        {
            if (gooObj is FileDataGoo fileDataGoo)
            {
                var fileData = fileDataGoo.Value;
                if (fileData == null)
                {
                    return null;
                }

                return new
                {
                    fileName = fileData.FileName ?? "",
                    fileType = fileData.FileType ?? "",
                    data = fileData.Data ?? "",
                    isBase64Encoded = fileData.IsBase64Encoded,
                    subFolder = fileData.SubFolder ?? ""
                };
            }

            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error extracting FileData from Goo: {ex.Message}");
            return null;
        }
    }
}
