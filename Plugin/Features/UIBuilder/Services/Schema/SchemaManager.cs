using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Selva.Features.ComputeIO.Components;
using Selva.Features.UIBuilder.Helpers;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Manages parameter scanning and schema validation
/// </summary>
public class SchemaManager
{
  private readonly Dictionary<Guid, ParameterMetadataSnapshot> _metadataCache = new();
  private readonly string _sessionId;

  public SchemaManager(string sessionId)
  {
    _sessionId = sessionId;
  }

  /// <summary>
  ///   Scan document and return available parameters (inputs only)
  /// </summary>
  public AvailableParameters ScanParameters(GH_Document document)
  {
    // Scan for all contextual parameters (inputs only)
    var allParams = document.Objects
      .OfType<IGH_ContextualParameter>()
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
      if (docObj == null) continue;

      var ghParam = param as IGH_Param;
      var paramType = GetParameterTypeName(param);

      var availableParam = new AvailableParameter
      {
        Id = docObj.InstanceGuid,
        Name = docObj.Name,
        Nickname = docObj.NickName,
        Description = docObj.Description ?? "",
        Category = "input",
        ParamType = paramType,
        Default = null, // Will be set below based on parameter type
        AtLeast = param.AtLeast,
        AtMost = param.AtMost
      };

      // Handle ValueList parameters specially
      if (param is GetValueListParameter valueListParameter)
        try
        {
          // Extract the options dictionary from the ValueList
          var rawValues = valueListParameter.Values;
          if (rawValues is IDictionary idict)
          {
            var dict = new Dictionary<string, object>();
            foreach (DictionaryEntry de in idict)
            {
              var key = de.Key?.ToString() ?? string.Empty;
              dict[key] = de.Value;
            }

            availableParam.Options = dict;
          }

          var selectedValue = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable();
          if (selectedValue != null && availableParam.Options != null)
          {
            foreach (var kvp in availableParam.Options)
            {
              if (kvp.Value?.ToString() == selectedValue?.ToString())
              {
                availableParam.Default = kvp.Key;
                break;
              }
            }

            if (availableParam.Default == null && availableParam.Options.Count > 0)
              availableParam.Default = availableParam.Options.Keys.First();
          }
        }
        catch
        {
          // ignored
        }
      else
        availableParam.Default = ghParam?.VolatileData.AllData(true).FirstOrDefault()
          ?.ScriptVariable(); //TODO: properly handle tree inputs (not a priority for now)

      try
      {
        var treeAccessProp = param.GetType().GetProperty("TreeAccess");
        if (treeAccessProp != null) availableParam.TreeAccess = Convert.ToBoolean(treeAccessProp.GetValue(param, null));
      }
      catch
      {
        // ignored
      }

      ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, availableParam);
      availableParameters.Parameters.Add(availableParam);
    }

    return availableParameters;
  }

  /// <summary>
  ///   Scan document and return available outputs (separate from parameters)
  /// </summary>
  public List<AvailableOutput> ScanOutputs(GH_Document document)
  {
    var outputs = new List<AvailableOutput>();

    // Scan for context output components (print, bake)
    var contextOutputs = document.Objects
      .Where(ParameterTypeHelper.IsContextOutputComponent)
      .ToList();

    foreach (var output in contextOutputs)
    {
      if (output == null) continue;

      // Determine output type based on component type
      var outputType = "print"; // Default
      if (output.Name.IndexOf("Bake", StringComparison.OrdinalIgnoreCase) >= 0) outputType = "bake";

      outputs.Add(new AvailableOutput
      {
        Id = output.InstanceGuid,
        Nickname = output.NickName,
        Description = output.Description ?? "",
        OutputType = outputType
      });
    }

    // Scan for ContextBake components that have FileData (file downloads)
    var (hasFileOutputs, fileOutputs) = ParameterTypeHelper.DetectDownloadableOutputs(document);
    foreach (var fileOutput in fileOutputs)
    {
      outputs.Add(new AvailableOutput
      {
        Id = fileOutput.Id,
        Nickname = fileOutput.Nickname,
        Description = fileOutput.Description ?? "",
        OutputType = "file"
      });
    }

    return outputs;
  }

  /// <summary>
  ///   Validate no duplicate parameter names
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
  ///   Validate schema against current document - removes references to missing parameters
  ///   Wrapper for ValidateSchemaAndTrackChanges without tracking
  /// </summary>
  public UISchema ValidateSchema(UISchema schema, GH_Document document)
  {
    return ValidateSchemaAndTrackChanges(schema, document, false).Schema;
  }

  /// <summary>
  ///   Validate schema and optionally track what changed (removed parameters)
  /// </summary>
  public (UISchema Schema, List<Guid> RemovedIds) ValidateSchemaAndTrackChanges(
    UISchema schema,
    GH_Document document,
    bool trackChanges = true)
  {
    if (schema == null) return (null, new List<Guid>());

    var removedIds = trackChanges ? new List<Guid>() : null;

    var inputsToRemove = schema.Inputs.Where(input =>
    {
      var paramObject = document.FindObject(input.Id, false);
      return paramObject == null;
    }).ToList();

    if (trackChanges) removedIds.AddRange(inputsToRemove.Select(i => i.Id));

    schema.Inputs.RemoveAll(input => inputsToRemove.Contains(input));

    var outputsToRemove = schema.Outputs.Where(output =>
    {
      var paramObject = document.FindObject(output.Id, false);
      return paramObject == null;
    }).ToList();

    if (trackChanges) removedIds.AddRange(outputsToRemove.Select(o => o.Id));

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

    return (schema, removedIds ?? new List<Guid>());
  }

  /// <summary>
  ///   Get parameter type name from contextual parameter
  /// </summary>
  private string GetParameterTypeName(IGH_ContextualParameter contextParam)
  {
    if (contextParam is IGH_Param param) return GetParameterTypeNameFromParam(param);

    return "Unknown";
  }

  /// <summary>
  ///   Map Grasshopper parameter type to Compute-compatible type name using dictionary
  /// </summary>
  private string GetParameterTypeNameFromParam(IGH_Param param)
  {
    if (param == null) return "Unknown";

    var typeName = param.GetType().Name;

    //Will make proper use of this in the future
    var typeKeywords = new Dictionary<string, string>
    {
      { "GetNumberParameter", "Number" },
      { "Slider", "Number" },
      { "ValueList", "ValueList" },
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

    foreach (var kvp in typeKeywords)
    {
      if (typeName.Contains(kvp.Key)) return kvp.Value;
    }

    return "Generic";
  }

  /// <summary>
  ///   Detect metadata changes in parameters since last scan.
  ///   Returns list of parameters with changed metadata and also applies changes to the schema.
  /// </summary>
  public List<AvailableParameter> DetectMetadataChanges(GH_Document document, UISchema schema)
  {
    var changes = new List<AvailableParameter>();

    if (schema == null) return changes;

    // Check input parameters
    foreach (var inputParam in schema.Inputs)
    {
      var docObj = document.FindObject(inputParam.Id, false);
      if (docObj == null) continue;

      var currentSnapshot = CreateParameterSnapshot(docObj);
      if (currentSnapshot == null) continue;

      if (_metadataCache.TryGetValue(inputParam.Id, out var previousSnapshot))
        if (!currentSnapshot.Equals(previousSnapshot))
        {
          // Metadata changed - create updated AvailableParameter
          var updatedParam = CreateAvailableParameterFromSnapshot(currentSnapshot, inputParam.Id, "input");
          changes.Add(updatedParam);
        }

      // Always update cache with current state
      _metadataCache[inputParam.Id] = currentSnapshot;
    }

    // Check output parameters
    foreach (var outputParam in schema.Outputs)
    {
      var docObj = document.FindObject(outputParam.Id, false);
      if (docObj == null) continue;

      var currentSnapshot = CreateParameterSnapshot(docObj);
      if (currentSnapshot == null) continue;

      if (_metadataCache.TryGetValue(outputParam.Id, out var previousSnapshot))
        if (!currentSnapshot.Equals(previousSnapshot))
        {
          var updatedParam = CreateAvailableParameterFromSnapshot(currentSnapshot, outputParam.Id, "output");
          changes.Add(updatedParam);
        }

      // Always update cache with current state
      _metadataCache[outputParam.Id] = currentSnapshot;
    }

    // Apply changes to the schema so it stays in sync
    if (changes.Count > 0) ApplyMetadataChangesToSchema(schema, changes);

    return changes;
  }

  /// <summary>
  ///   Apply detected metadata changes to the schema.
  ///   Updates layout item configs (min/max/stepSize for numbers, options for dropdowns).
  /// </summary>
  public void ApplyMetadataChangesToSchema(UISchema schema, List<AvailableParameter> changes)
  {
    if (schema?.Layout?.Tabs == null || changes == null || changes.Count == 0) return;

    foreach (var change in changes)
    {
      // Find and update the layout item for this parameter
      foreach (var tab in schema.Layout.Tabs)
      {
        foreach (var group in tab.Groups)
        {
          foreach (var item in group.Items)
          {
            if (item.ParamId != change.Id) continue;

            // Update based on widget type
            switch (item)
            {
              case InputNumberLayoutItem numberItem:
                numberItem.Config ??= new NumberWidgetConfig();
                numberItem.Config.Minimum = change.Minimum;
                numberItem.Config.Maximum = change.Maximum;
                numberItem.Config.StepSize = change.StepSize;
                break;

              case InputDropdownLayoutItem dropdownItem:
                dropdownItem.Config ??= new DropdownWidgetConfig();
                dropdownItem.Config.Options = change.Options;
                break;
            }

            // Also update displayName/description if changed
            item.DisplayName = change.Nickname;
            item.Description = change.Description;
          }
        }
      }

      // Also update the Inputs list
      var inputParam = schema.Inputs.FirstOrDefault(i => i.Id == change.Id);
      if (inputParam != null)
      {
        inputParam.Nickname = change.Nickname;
        inputParam.Description = change.Description;
      }
    }
  }

  /// <summary>
  ///   Create a snapshot of parameter metadata for comparison
  /// </summary>
  private ParameterMetadataSnapshot CreateParameterSnapshot(IGH_DocumentObject docObj)
  {
    if (docObj == null) return null;

    var param = docObj as IGH_ContextualParameter;
    var ghParam = docObj as IGH_Param;

    var snapshot = new ParameterMetadataSnapshot
    {
      Id = docObj.InstanceGuid,
      Nickname = docObj.NickName,
      Description = docObj.Description ?? ""
    };

    // Extract numeric constraints if applicable
    if (param != null && ghParam != null)
    {
      var availableParam = new AvailableParameter { Id = docObj.InstanceGuid };
      ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, availableParam);

      snapshot.Minimum = availableParam.Minimum;
      snapshot.Maximum = availableParam.Maximum;
      snapshot.StepSize = availableParam.StepSize;
    }

    // Extract ValueList options if applicable
    if (docObj is GetValueListParameter valueListParam) snapshot.Options = valueListParam.Values;

    return snapshot;
  }

  /// <summary>
  ///   Create an AvailableParameter from a metadata snapshot
  /// </summary>
  private AvailableParameter CreateAvailableParameterFromSnapshot(
    ParameterMetadataSnapshot snapshot,
    Guid id,
    string category)
  {
    var param = new AvailableParameter
    {
      Id = id,
      Nickname = snapshot.Nickname,
      Description = snapshot.Description,
      Minimum = snapshot.Minimum,
      Maximum = snapshot.Maximum,
      StepSize = snapshot.StepSize,
      Category = category
    };

    // Convert Options to the expected format
    if (snapshot.Options != null)
      param.Options = snapshot.Options.ToDictionary(kvp => kvp.Key, kvp => (object)kvp.Value);

    return param;
  }

  /// <summary>
  ///   Clear metadata cache (e.g., when schema is disabled)
  /// </summary>
  public void ClearMetadataCache()
  {
    _metadataCache.Clear();
  }
}

/// <summary>
///   Snapshot of parameter metadata for change detection
/// </summary>
internal class ParameterMetadataSnapshot
{
  public Guid Id { get; set; }
  public string Nickname { get; set; }
  public string Description { get; set; }
  public double? Minimum { get; set; }
  public double? Maximum { get; set; }
  public double? StepSize { get; set; }
  public Dictionary<string, string> Options { get; set; }

  public override bool Equals(object obj)
  {
    if (!(obj is ParameterMetadataSnapshot other)) return false;

    return Id == other.Id &&
           Nickname == other.Nickname &&
           Description == other.Description &&
           Minimum == other.Minimum &&
           Maximum == other.Maximum &&
           StepSize == other.StepSize &&
           OptionsEqual(Options, other.Options);
  }

  private static bool OptionsEqual(Dictionary<string, string> a, Dictionary<string, string> b)
  {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (a.Count != b.Count) return false;

    foreach (var kvp in a)
    {
      if (!b.TryGetValue(kvp.Key, out var value) || value != kvp.Value)
        return false;
    }

    return true;
  }

  public override int GetHashCode()
  {
    return Id.GetHashCode();
  }
}
