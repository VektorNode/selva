using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Features.FileIO.Services;
using Selva.Features.IO.Componets;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Services;

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
    {
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
    {
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

    var fileOutputs = schema.Outputs.Where(o => o.OutputType == "file").ToList();

    foreach (var fileOutput in fileOutputs)
    {
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
    }

    return fileOutputData;
  }

  /// <summary>
  ///   Extract value from a parameter, handling ValueList parameters specially
  /// </summary>
  private object ExtractParameterValue(IGH_Param ghParam, InputParamSchema input)
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
      {
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
    }

    return fileDataList;
  }

  /// <summary>
  ///   Extract the key/name from ValueList data (not the expression value)
  /// </summary>
  private object ExtractKeyFromValueListData(IGH_Goo data)
  {
    if (data is GH_ValueListData valueListData) return valueListData.SelectedName;

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
