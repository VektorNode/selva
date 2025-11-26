using System;
using System.Collections.Generic;
using System.Reflection;
using Selva.Plugin.Models.Generated;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace Selva.Utils;

/// <summary>
///   Helper class for parameter type checking
///   Consolidates repeated type validation logic
/// </summary>
public static class ParameterTypeHelper
{
  /// <summary>
  ///   Check if an object is a context output component (ContextPrintComponent or ContextBakeComponent)
  /// </summary>
  public static bool IsContextOutputComponent(IGH_DocumentObject obj)
  {
    if (obj == null)
    {
      return false;
    }

    var typeName = obj.GetType()?.Name;
    return string.Equals(typeName, "ContextPrintComponent", StringComparison.Ordinal);
  }


  public static bool IsContextBakeComponent(IGH_DocumentObject obj)
  {
    if (obj == null)
    {
      return false;
    }

    var typeName = obj.GetType()?.Name;
    return string.Equals(typeName, "ContextBakeComponent", StringComparison.Ordinal);
  }


  /// <summary>
  ///   Extract minimum, maximum, and step size from a contextual parameter
  ///   Prioritizes slider values if connected, falls back to parameter properties
  /// </summary>
  public static void ExtractNumberParameterConstraints(
    IGH_ContextualParameter param,
    IGH_Param ghParam,
    AvailableParameter availableParam)
  {
    double? minimum = null;
    double? maximum = null;
    decimal? stepSize = null;

    var getNumberType = param.GetType();

    // Try to get min/max from parameter properties
    if (getNumberType.Name == "GetNumberParameter")
    {
      ExtractParameterMinMax(param, availableParam, ref minimum, ref maximum);
    }

    // Helper to detect extreme sentinel values
    const double extremeThreshold = 7.9e307;

    bool IsExtreme(double v)
    {
      return double.IsInfinity(v) || double.IsNaN(v) || Math.Abs(v) >= extremeThreshold;
    }

    // Check if we need to look for alternative sources
    var needsAlternativeSource = !minimum.HasValue || !maximum.HasValue ||
                                 IsExtreme(minimum.GetValueOrDefault()) ||
                                 IsExtreme(maximum.GetValueOrDefault());

    if (needsAlternativeSource)
    {
      // Try to get values from a connected slider
      if (ghParam?.SourceCount == 1 && ghParam.Sources[0] is GH_NumberSlider slider)
      {
        try
        {
          minimum = Convert.ToDouble(slider.Slider.Minimum);
          maximum = Convert.ToDouble(slider.Slider.Maximum);
          stepSize = slider.Slider.Epsilon;
        }
        catch (Exception ex)
        {
          Console.WriteLine(
            $"Warning: Failed to extract slider constraints for '{availableParam.Nickname}': {ex.Message}");
          // Fall back to defaults
          minimum = 0.0;
          maximum = 100.0;
          stepSize = 1m;
        }
      }
      else
      {
        // No slider available, use defaults
        minimum = 0.0;
        maximum = 100.0;
        stepSize = 1m;
      }
    }
    else if (ghParam?.SourceCount == 1 && ghParam.Sources[0] is GH_NumberSlider slider)
    {
      // Valid parameter values exist, but if there's a slider, just get the step size
      try
      {
        stepSize = slider.Slider.Epsilon;
      }
      catch (Exception ex)
      {
        Console.WriteLine(
          $"Warning: Failed to extract slider step size for '{availableParam.Nickname}': {ex.Message}");
      }
    }

    // Apply extracted values
    if (minimum.HasValue && maximum.HasValue)
    {
      availableParam.Minimum = minimum.Value;
      availableParam.Maximum = maximum.Value;
      if (stepSize.HasValue)
      {
        availableParam.StepSize = (double)stepSize.Value;
      }
    }
  }

  private static bool TryGetPropertyValue<T>(object obj, string propName, out T value)
  {
    value = default;
    if (obj == null)
    {
      return false;
    }

    var type = obj.GetType();
    const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic |
                               BindingFlags.FlattenHierarchy;

    var prop = type.GetProperty(propName, flags);
    if (prop == null)
    {
      foreach (var p in type.GetProperties(flags))
      {
        if (string.Equals(p.Name, propName, StringComparison.OrdinalIgnoreCase) ||
            p.Name.EndsWith("." + propName, StringComparison.Ordinal))
        {
          prop = p;
          break;
        }
      }
    }

    if (prop == null)
    {
      return false;
    }

    var raw = prop.GetValue(obj);
    if (raw == null)
    {
      return false;
    }

    try
    {
      if (raw is T t)
      {
        value = t;
        return true;
      }

      if (typeof(T) == typeof(double) && raw is decimal dec)
      {
        value = (T)(object)Convert.ToDouble(dec);
        return true;
      }

      value = (T)Convert.ChangeType(raw, typeof(T));
      return true;
    }
    catch
    {
      return false;
    }
  }

  private static void ExtractParameterMinMax(
    IGH_ContextualParameter param,
    AvailableParameter availableParam,
    ref double? minimum,
    ref double? maximum)
  {
    if (TryGetPropertyValue<double>(param, "Minimum", out var minValue))
    {
      if (!double.IsNegativeInfinity(minValue) && !double.IsNaN(minValue) && minValue != 0)
      {
        minimum = minValue;
      }
    }

    if (TryGetPropertyValue<double>(param, "Maximum", out var maxValue))
    {
      if (!double.IsPositiveInfinity(maxValue) && !double.IsNaN(maxValue) && maxValue != 0)
      {
        maximum = maxValue;
      }
    }
  }

  public static ClearResult ClearContextualParameters(List<IGH_ContextualParameter> contextualParams,
    GH_Component component)
  {
    var clearedCount = 0;
    var errorCount = 0;
    var recipientsToExpire = new HashSet<IGH_ActiveObject>();

    foreach (var contextParam in contextualParams)
    {
      try
      {
        ClearSingleParameter(contextParam);
        clearedCount++;

        var paramName = (contextParam as IGH_DocumentObject)?.NickName ?? "Unknown";
        component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, $"Cleared: {paramName}");

        CollectRecipients(contextParam, recipientsToExpire);
      }
      catch (Exception ex)
      {
        var paramName = (contextParam as IGH_DocumentObject)?.NickName ?? "Unknown";
        component.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Error clearing {paramName}: {ex.Message}");
        errorCount++;
      }
    }

    ExpireRecipients(recipientsToExpire, component);

    return new ClearResult
    {
      ClearedCount = clearedCount,
      ExpiredCount = recipientsToExpire.Count,
      ErrorCount = errorCount,
      Message =
        $"Cleared: {clearedCount} parameters\nExpired: {recipientsToExpire.Count} components\nErrors: {errorCount}"
    };
  }

  private static void ClearSingleParameter(IGH_ContextualParameter contextParam)
  {
    var clearMethod = contextParam.GetType().GetMethod("ClearContextualData");
    if (clearMethod != null)
    {
      clearMethod.Invoke(contextParam, null);
    }

    var collectVolatileData = contextParam.GetType().GetMethod("CollectVolatileData_FromSources");
    if (collectVolatileData != null)
    {
      collectVolatileData.Invoke(contextParam, null);
    }
  }

  private static void CollectRecipients(IGH_ContextualParameter contextParam,
    HashSet<IGH_ActiveObject> recipients)
  {
    if (contextParam is IGH_Param param)
    {
      foreach (var recipient in param.Recipients)
      {
        if (recipient is IGH_ActiveObject activeRecipient)
        {
          recipients.Add(activeRecipient);
        }
      }
    }
  }

  private static void ExpireRecipients(HashSet<IGH_ActiveObject> recipients, GH_Component component)
  {
    foreach (var recipient in recipients)
    {
      try
      {
        recipient.ExpirePreview(false);
      }
      catch (Exception ex)
      {
        component.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Error expiring component: {ex.Message}");
      }
    }
  }

  /// <summary>
  ///   Detect ContextBake components that have FileData in their input sources
  ///   Returns a tuple containing:
  ///   - bool: whether downloadable outputs exist
  ///   - List<DownloadableComponent>: id and nickname pairs of ContextBake components with FileData
  /// </summary>
  public static (bool HasDownloadableOutputs, List<DownloadableComponent> DownloadableComponents) DetectDownloadableOutputs(
    GH_Document document)
  {
    var downloadableComponents = new List<DownloadableComponent>();

    if (document == null)
    {
      return (false, downloadableComponents);
    }

    try
    {
      // Find all ContextBake components in the document
      foreach (var obj in document.Objects)
      {
        if (!IsContextBakeComponent(obj))
        {
          continue;
        }

        var contextBakeComponent = obj as IGH_Component;
        if (contextBakeComponent?.Params.Input == null)
        {
          continue;
        }

        // Check if any of the input parameters have FileData
        var hasFileData = false;
        foreach (var inputParam in contextBakeComponent.Params.Input)
        {
          if (inputParam == null || inputParam.SourceCount == 0)
          {
            continue;
          }

          // Check the data from the input sources
          try
          {
            var data = inputParam.VolatileData;
            if (data == null || data.IsEmpty)
            {
              continue;
            }

            // Iterate through all data in the param
            var allData = data.AllData(true);
            foreach (var item in allData)
            {
              // Check if this item is FileDataGoo
              if (item?.GetType().Name == "FileDataGoo")
              {
                hasFileData = true;
                break;
              }
            }
          }
          catch
          {
            // Silently skip on error
          }

          if (hasFileData)
          {
            break;
          }
        }

        // If this ContextBake has FileData, record its id and nickname
        if (hasFileData)
        {
          var docObj = obj as IGH_DocumentObject;
          if (docObj == null)
          {
            continue;
          }
          var nickname = docObj.NickName;
          var instanceGuid = docObj.InstanceGuid;

          downloadableComponents.Add(new DownloadableComponent
          {
            Id = instanceGuid,
            Nickname = nickname
          });
        }
      }
    }
    catch (Exception ex)
    {
      Console.WriteLine($"Warning: Error detecting downloadable outputs: {ex.Message}");
    }

    return (downloadableComponents.Count > 0, downloadableComponents);
  }

  public class ClearResult
  {
    public int ClearedCount { get; set; }
    public int ExpiredCount { get; set; }
    public int ErrorCount { get; set; }
    public string Message { get; set; }
  }
}
