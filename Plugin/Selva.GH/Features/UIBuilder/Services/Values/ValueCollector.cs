using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Core.Models;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Features.UIBuilder.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Values;

/// <summary>
///   Handles collection and extraction of values from Grasshopper parameters and components
/// </summary>
public class ValueCollector
{
    /// <summary>
    ///   Collect current input values from all parameters in the schema
    /// </summary>
    public Dictionary<string, object> CollectInputValues(GH_Document document, UISchema schema,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var currentValues = new Dictionary<string, object>();

        if (schema?.Inputs == null || schema.Inputs.Count == 0) return currentValues;

        foreach (var input in schema.Inputs)
            try
            {
                var paramObject = document.FindObject(input.Id, false);
                if (paramObject == null) continue;

                if (paramObject is IGH_Param ghParam)
                {
                    var value = ExtractParameterValue(ghParam, input);
                    if (value != null) currentValues[input.Id.ToString()] = value;
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting current value for '{input.Nickname}': {ex.Message}");
            }

        return currentValues;
    }

    /// <summary>
    ///   Collect output values from all output components in the schema
    /// </summary>
    public Dictionary<string, object> CollectOutputValues(GH_Document document, UISchema schema,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var outputValues = new Dictionary<string, object>();

        if (schema?.Outputs == null || schema.Outputs.Count == 0) return outputValues;

        foreach (var output in schema.Outputs)
            try
            {
                var paramObject = document.FindObject(output.Id, false);
                if (paramObject == null) continue;

                if (paramObject is IGH_Component ghComponent)
                {
                    var value = ExtractComponentOutput(ghComponent);
                    if (value != null) outputValues[output.Id.ToString()] = value;
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting output '{output.Nickname}': {ex.Message}");
            }

        return outputValues;
    }

    /// <summary>
    ///   Collect file outputs from components that output FileData
    /// </summary>
    public Dictionary<string, object> CollectFileOutputs(GH_Document document, UISchema schema,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var fileOutputData = new Dictionary<string, object>();

        if (schema?.Outputs == null || schema.Outputs.Count == 0) return fileOutputData;

        var fileOutputs = schema.Outputs.Where(o => o.Type == "file").ToList();

        foreach (var fileOutput in fileOutputs)
            try
            {
                var componentObject = document.FindObject(fileOutput.Id, false);
                if (componentObject == null) continue;

                if (componentObject is IGH_Component component)
                {
                    var fileDataList = ExtractFileDataFromComponent(component, addMessage);
                    if (fileDataList.Count > 0)
                        fileOutputData[fileOutput.Id.ToString()] = fileDataList.Count == 1
                            ? fileDataList[0]
                            : fileDataList;
                }
            }
            catch (Exception ex)
            {
                addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                    $"Error collecting file output '{fileOutput.Nickname}': {ex.Message}");
            }

        return fileOutputData;
    }

    /// <summary>
    ///   Collect display data from all WebDisplay components in the document.
    ///   Returns an array of MeshBatch objects (as JSON-serializable objects).
    ///   This is not tied to specific output schema items - it collects from ALL WebDisplay components.
    /// </summary>
    public List<object> CollectDisplayData(GH_Document document,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var displayDataList = new List<object>();

        if (document == null) return displayDataList;

        var componentCount = 0;
        foreach (var docObject in document.Objects)
            if (docObject is IGH_Component component)
            {
                componentCount++;
                try
                {
                    var displayData = ExtractWebDisplayDataFromComponent(component, addMessage);
                    if (displayData != null)
                    {
                        Debug.WriteLine($"[ValueCollector] Found display data from component '{component.NickName}'");
                        displayDataList.Add(displayData);
                    }
                }
                catch (Exception ex)
                {
                    addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                        $"Error collecting display data from component '{component.NickName}': {ex.Message}");
                }
            }

        Debug.WriteLine(
            $"[ValueCollector] CollectDisplayData: scanned {componentCount} components, found {displayDataList.Count} display data items");
        return displayDataList;
    }

    /// <summary>
    ///   Extract value from a parameter, handling ValueList parameters specially
    /// </summary>
    private object ExtractParameterValue(IGH_Param ghParam, SchemaInput input)
    {
        if (ghParam is GetValueListParameter valueListParam) return ExtractValueListValue(valueListParam);

        if (ghParam.SourceCount == 1) return ExtractDataFromVolatileData(ghParam.Sources[0].VolatileData);

        return null;
    }

    /// <summary>
    ///   Extract value from ValueList parameter
    /// </summary>
    private object ExtractValueListValue(GetValueListParameter valueListParam)
    {
        var valueData = valueListParam.VolatileData;
        if (valueData != null && !valueData.IsEmpty)
        {
            var allData = valueData.AllData(true).ToList();
            if (allData.Count == 1) return ExtractKeyFromValueListData(allData[0]);

            if (allData.Count > 1) return allData.Select(d => ExtractKeyFromValueListData(d)).ToList();
        }

        return null;
    }

    /// <summary>
    ///   Extract output value from a component's input parameters
    /// </summary>
    private object ExtractComponentOutput(IGH_Component component)
    {
        var inputParam = component.Params.Input.FirstOrDefault();
        if (inputParam?.VolatileData != null && !inputParam.VolatileData.IsEmpty)
            return ExtractDataFromVolatileData(inputParam.VolatileData);

        return null;
    }

    /// <summary>
    ///   Extract data from IGH_Structure (handles single values and lists)
    /// </summary>
    private object ExtractDataFromVolatileData(IGH_Structure volatileData)
    {
        if (volatileData == null || volatileData.IsEmpty) return null;

        var allData = volatileData.AllData(true).ToList();
        if (allData.Count == 1) return ExtractValue(allData[0]);

        if (allData.Count > 1) return allData.Select(d => ExtractValue(d)).ToList();

        return null;
    }

    /// <summary>
    ///   Extract FileData from all inputs of a component
    /// </summary>
    private List<object> ExtractFileDataFromComponent(IGH_Component component,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        var fileDataList = new List<object>();

        foreach (var inputParam in component.Params.Input)
        {
            if (inputParam?.VolatileData == null || inputParam.VolatileData.IsEmpty) continue;

            var allData = inputParam.VolatileData.AllData(true);
            foreach (var gooObj in allData)
                if (gooObj?.GetType().FullName != null &&
                        gooObj.GetType().FullName.IndexOf("FileDataGoo", StringComparison.OrdinalIgnoreCase) >= 0)
                    try
                    {
                        var extractedFileData = ExtractFileDataFromGoo(gooObj);
                        if (extractedFileData != null) fileDataList.Add(extractedFileData);
                    }
                    catch (Exception ex)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Error extracting FileData from Goo: {ex.Message}");
                    }
        }

        return fileDataList;
    }

    /// <summary>
    ///   Extract WebDisplayGoo data from a component's output parameters.
    ///   Returns the MeshBatch object only if the output is wired into a ContextBakeComponent,
    ///   mirroring the Rhino.Compute behaviour where baking is explicit.
    /// </summary>
    private object ExtractWebDisplayDataFromComponent(IGH_Component component,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        if (component?.Params?.Output == null || component.Params.Output.Count == 0) return null;

        foreach (var outputParam in component.Params.Output)
        {
            if (outputParam?.VolatileData == null || outputParam.VolatileData.IsEmpty) continue;

            // Only collect display data when the output is wired into a ContextBakeComponent.
            var connectedToContextBake = outputParam.Recipients
                .Any(r => ParameterTypeHelper.IsContextBakeComponent(r?.Attributes?.GetTopLevel?.DocObject));

            if (!connectedToContextBake) continue;

            var allData = outputParam.VolatileData.AllData(true);
            foreach (var gooObj in allData)
                if (gooObj is WebDisplayGoo webDisplayGoo && webDisplayGoo.IsValid)
                    try
                    {
                        return webDisplayGoo.Value;
                    }
                    catch (Exception ex)
                    {
                        addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
                            $"Error extracting WebDisplayGoo data: {ex.Message}");
                    }
        }

        return null;
    }

    /// <summary>
    ///   Extract the key/name from ValueList data (not the expression value)
    /// </summary>
    private object ExtractKeyFromValueListData(IGH_Goo data)
    {
        if (data is GH_ValueListDataGoo valueListData) return valueListData.SelectedName;

        return ExtractValue(data);
    }

    /// <summary>
    ///   Extract value from IGH_Goo wrapper
    /// </summary>
    private object ExtractValue(IGH_Goo data)
    {
        if (data is GH_String ghString) return ghString.Value;

        if (data is GH_Number ghNumber) return ghNumber.Value;

        if (data is GH_Integer ghInteger) return ghInteger.Value;

        if (data is GH_Boolean ghBoolean) return ghBoolean.Value;

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
                            fileEnding = fileEnding,
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

        if (data.CastTo(out string strValue)) return strValue;

        return data?.ToString() ?? "";
    }

    /// <summary>
    ///   Extract FileData object from FileDataGoo using direct casting
    /// </summary>
    private object ExtractFileDataFromGoo(IGH_Goo gooObj)
    {
        if (gooObj == null) return null;

        try
        {
            if (gooObj is FileDataGoo fileDataGoo)
            {
                var fileData = fileDataGoo.Value;
                if (fileData == null) return null;

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
