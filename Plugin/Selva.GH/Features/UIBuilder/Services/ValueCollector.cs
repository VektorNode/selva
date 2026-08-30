using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Schema.Models;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.ComputeIO.Goos;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

public class ValueCollector
{
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
                    var value = output.Type switch
                    {
                        "chart" => ExtractChartOutput(ghComponent),
                        "dynamicValueList" => ExtractDynamicValueListOutput(ghComponent),
                        _ => ExtractComponentOutput(ghComponent)
                    };
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
    ///     Every ContextBake in the document, in document order. These are the components whose
    ///     volatile data <see cref="CollectDisplayData" /> reads, so expiring them is what
    ///     regenerates display geometry after a cleared or expired solution.
    /// </summary>
    public static List<IGH_ActiveObject> FindContextBakes(GH_Document document)
    {
        var bakes = new List<IGH_ActiveObject>();
        if (document == null)
        {
            return bakes;
        }

        foreach (var docObject in document.Objects)
        {
            if (docObject is IGH_Component component && IsContextBakeComponent(component))
            {
                bakes.Add(component);
            }
        }

        return bakes;
    }

    /// <summary>
    ///     Collects display data from ContextBake inputs, mirroring Rhino.Compute's explicit baking.
    ///     When <paramref name="bakeIds" /> is given, only those components are visited instead of
    ///     scanning the whole document.
    /// </summary>
    public List<object> CollectDisplayData(GH_Document document,
        IReadOnlyCollection<Guid> bakeIds = null,
        Action<GH_RuntimeMessageLevel, string> addMessage = null)
    {
        var displayDataList = new List<object>();

        if (document == null)
        {
            return displayDataList;
        }

        var contextBakeCount = 0;

        IEnumerable<IGH_DocumentObject> candidates;
        if (bakeIds != null && bakeIds.Count > 0)
        {
            var resolved = new List<IGH_DocumentObject>(bakeIds.Count);
            foreach (var id in bakeIds)
            {
                if (document.FindObject(id, false) is IGH_DocumentObject obj)
                {
                    resolved.Add(obj);
                }
            }

            candidates = resolved;
        }
        else
        {
            candidates = document.Objects;
        }

        foreach (var docObject in candidates)
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
    ///     Flattens all WebDisplayGoo objects from a ContextBake's inputs into a single list.
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

        return displayBatches.Count == 1 ? displayBatches[0] : displayBatches;
    }

    private static bool IsContextBakeComponent(IGH_Component component)
    {
        if (component == null)
        {
            return false;
        }

        var typeName = component.GetType()?.Name;
        return string.Equals(typeName, "ContextBakeComponent", StringComparison.Ordinal);
    }

    private object ExtractParameterValue(IGH_Param ghParam, SchemaInput input)
    {
        if (ghParam is GetValueListParameter valueListParam)
        {
            return ExtractValueListValue(valueListParam);
        }

        // The param's own volatile data is populated after solve for both wired and
        // persistent-data-backed params — the most reliable source, so try it first.
        var fromOwnVolatile = ExtractDataFromVolatileData(ghParam.VolatileData);
        if (fromOwnVolatile != null)
        {
            return fromOwnVolatile;
        }

        // Falls back to the wired source (e.g. a Boolean Toggle upstream) when this
        // param's own volatile data is empty — pre-solve, or non-collecting context params.
        if (ghParam.SourceCount == 1)
        {
            var fromSource = ExtractDataFromVolatileData(ghParam.Sources[0].VolatileData);
            if (fromSource != null)
            {
                return fromSource;
            }

            // Boolean Toggle exposes its state via a "Value" property, not VolatileData
            // when the doc hasn't solved yet. Read it directly so booleans default correctly.
            if (TryGetBoolProperty(ghParam.Sources[0], "Value", out var toggleValue))
            {
                return toggleValue;
            }
        }

        return null;
    }

    private static bool TryGetBoolProperty(object obj, string propName, out bool value)
    {
        value = false;
        if (obj == null)
        {
            return false;
        }

        try
        {
            var prop = obj.GetType()
                .GetProperty(propName, System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            if (prop?.GetValue(obj) is bool b)
            {
                value = b;
                return true;
            }
        }
        catch
        {
            // ignored
        }

        return false;
    }

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

        // VolatileData only fills in during a solve, so it's empty right after document
        // load — but the connected value list's selection is available immediately.
        var selected = valueListParam.SelectedItems;
        if (selected.Count > 1)
        {
            return selected.Select(s => s.Expression).ToList();
        }

        var defaultValue = valueListParam.GetDefaultValue();
        return string.IsNullOrEmpty(defaultValue) ? null : defaultValue;
    }

    private object ExtractComponentOutput(IGH_Component component)
    {
        var inputParam = component.Params.Input.FirstOrDefault();
        if (inputParam?.VolatileData != null && !inputParam.VolatileData.IsEmpty)
        {
            return ExtractDataFromVolatileData(inputParam.VolatileData);
        }

        return null;
    }

    private object ExtractDynamicValueListOutput(IGH_Component component)
    {
        return BuildFirstInputPayload(component);
    }

    private object ExtractChartOutput(IGH_Component component)
    {
        return BuildFirstInputPayload(component);
    }

    /// <summary>
    ///     Walks the first input's volatile data, projects each goo into a Rhino-free <see cref="GooView" />,
    ///     and asks <see cref="OutputPayloadBuilder" /> to classify and build the payload. All ContextBake-wired
    ///     output types (dynamicValueList / chart / file) go through here, so the wire shape for each is
    ///     decided in one unit-tested place instead of three.
    /// </summary>
    private object BuildFirstInputPayload(IGH_Component component)
    {
        var inputParam = component.Params.Input.FirstOrDefault();
        if (inputParam?.VolatileData == null || inputParam.VolatileData.IsEmpty)
        {
            Logger.Log($"[ValueCollector] ContextBake '{component.NickName}' output: {BuildOutcome.EmptyResult}");
            return null;
        }

        // Logged so a null payload says why (empty / unknown type) instead of silently vanishing.
        var views = inputParam.VolatileData.AllData(true).Select(ProjectGoo);
        var outcome = OutputPayloadBuilder.Classify(views);

        Logger.Log($"[ValueCollector] ContextBake '{component.NickName}' output: {outcome}");

        return outcome.Payload;
    }

    /// <summary>
    ///     Reduces a goo to the Rhino-free facts <see cref="OutputPayloadBuilder" /> needs. The only place
    ///     that touches Rhino goo types for ContextBake outputs.
    /// </summary>
    private GooView ProjectGoo(IGH_Goo goo)
    {
        if (goo == null)
        {
            return null;
        }

        // Custom goo arrives wrapped in GH_ObjectWrapper on a generic ContextBake input — unwrap
        // before the type checks below, or the match silently fails.
        var inner = goo is GH_ObjectWrapper wrapper ? wrapper.Value as IGH_Goo ?? goo : goo;

        if (inner is DynamicValueListGoo dvl)
        {
            return new GooView { TypeName = inner.TypeName, DynamicValueList = dvl.Payload };
        }

        if (string.Equals(inner.TypeName, "Plotly Figure", StringComparison.Ordinal))
        {
            var json = inner.GetType().GetMethod("ToJson")?.Invoke(inner, null) as string;
            return new GooView { TypeName = inner.TypeName, ChartJson = string.IsNullOrEmpty(json) ? null : json };
        }

        if (inner is FileDataGoo fileGoo)
        {
            return new GooView { TypeName = inner.TypeName, FilePayload = ExtractFileDataFromGoo(fileGoo) };
        }

        return new GooView { TypeName = inner?.TypeName };
    }

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

        // FileInputGoo: return metadata only, never the full base64 file content.
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
                        var fileInputDataType = fileInputData.GetType();
                        var typeProperty = fileInputDataType.GetProperty("Type");
                        var fileEndingProperty = fileInputDataType.GetProperty("FileEnding");
                        var fileProperty = fileInputDataType.GetProperty("File");

                        var fileType = typeProperty?.GetValue(fileInputData)?.ToString() ?? "base64";
                        var fileEnding = fileEndingProperty?.GetValue(fileInputData)?.ToString() ?? "";
                        var fileContent = fileProperty?.GetValue(fileInputData)?.ToString() ?? "";

                        var metadata = new
                        {
                            type = fileType,
                            fileEnding,
                            file = fileContent.Length > 100 ? fileContent.Substring(0, 100) + "..." : fileContent,
                            _fileSize = fileContent.Length,
                            _isMetadata = true
                        };

                        return metadata;
                    }
                }
            }
            catch (Exception)
            {
            }
        }

        if (data.CastTo(out string strValue))
        {
            return strValue;
        }

        return data?.ToString() ?? "";
    }

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

                // subFolder is normalized here rather than on the client so both output paths
                // agree on what "ROOT::Panels" means. metadata rides along: FileData carries it
                // and the client reads it, but this hand-built payload used to drop it, so it
                // reached cloud consumers and never local ones.
                return new
                {
                    fileName = fileData.FileName ?? "",
                    fileType = fileData.FileType ?? "",
                    data = fileData.Data ?? "",
                    isBase64Encoded = fileData.IsBase64Encoded,
                    subFolder = SubFolderPath.ToArchivePath(fileData.SubFolder),
                    metadata = fileData.Metadata ?? new Dictionary<string, string>()
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
