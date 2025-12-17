using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.Core.Models;

/// <summary>
///   Centralized schema validation logic
/// </summary>
public class SchemaValidator
{
  /// <summary>
  ///   Validate a schema and return detailed results
  /// </summary>
  public ValidationResult Validate(UISchema schema)
  {
    if (schema == null)
    {
      return ValidationResult.Failure("Schema is null");
    }

    var issues = new List<ValidationIssue>();

    // Basic structure validation
    ValidateBasicStructure(schema, issues);

    // Parameter validation
    ValidateParameters(schema, issues);

    // Layout validation
    ValidateLayout(schema, issues);

    // Version validation
    ValidateVersioning(schema, issues);

    // Constraint validation
    ValidateConstraints(schema, issues);

    return new ValidationResult
    {
      IsValid = !issues.Any(i => i.Severity == ValidationSeverity.Error),
      Issues = issues
    };
  }

  /// <summary>
  ///   Validate that all required top-level fields are present
  /// </summary>
  private void ValidateBasicStructure(UISchema schema, List<ValidationIssue> issues)
  {
    if (string.IsNullOrEmpty(schema.Id))
    {
      issues.Add(ValidationIssue.Error(
        null,
        "Schema ID is required",
        "UISchema.Id must be a non-empty string"));
    }

    if (string.IsNullOrEmpty(schema.Name))
    {
      issues.Add(ValidationIssue.Error(
        null,
        "Schema name is required",
        "UISchema.Name must be a non-empty string"));
    }

    if (schema.Inputs == null)
    {
      issues.Add(ValidationIssue.Error(
        null,
        "Inputs array is null",
        "UISchema.Inputs must be an array (can be empty)"));
    }

    if (schema.Outputs == null)
    {
      issues.Add(ValidationIssue.Error(
        null,
        "Outputs array is null",
        "UISchema.Outputs must be an array (can be empty)"));
    }

    if (schema.Layout == null)
    {
      issues.Add(ValidationIssue.Error(
        null,
        "Layout is null",
        "UISchema.Layout must be defined"));
    }
  }

  /// <summary>
  ///   Validate parameter definitions
  /// </summary>
  private void ValidateParameters(UISchema schema, List<ValidationIssue> issues)
  {
    if (schema.Inputs == null || schema.Outputs == null)
    {
      return; // Already flagged in basic structure validation
    }

    var inputIds = new HashSet<Guid>();
    var outputIds = new HashSet<Guid>();

    // Validate inputs
    foreach (var input in schema.Inputs)
    {
      if (input.Id == Guid.Empty)
      {
        issues.Add(ValidationIssue.Error(
          null,
          "Input parameter has empty ID",
          "All InputParamSchema entries must have a non-empty GUID"));
        continue;
      }

      // Check for duplicate IDs
      if (!inputIds.Add(input.Id))
      {
        issues.Add(ValidationIssue.Error(
          input.Id.ToString(),
          $"Duplicate input parameter ID: {input.Id}",
          "Each input parameter must have a unique ID"));
      }

      // Validate param type
      if (string.IsNullOrEmpty(input.ParamType))
      {
        issues.Add(ValidationIssue.Warning(
          input.Id.ToString(),
          $"Input {input.Nickname ?? input.Id.ToString()} has no param type specified",
          "ParamType should be specified for proper parameter handling"));
      }
    }

    // Validate outputs
    foreach (var output in schema.Outputs)
    {
      if (output.Id == Guid.Empty)
      {
        issues.Add(ValidationIssue.Error(
          null,
          "Output parameter has empty ID",
          "All output entries must have a non-empty GUID"));
        continue;
      }

      // Check for duplicate IDs
      if (!outputIds.Add(output.Id))
      {
        issues.Add(ValidationIssue.Error(
          output.Id.ToString(),
          $"Duplicate output parameter ID: {output.Id}",
          "Each output parameter must have a unique ID"));
      }
    }
  }

  /// <summary>
  ///   Validate layout structure and integrity
  /// </summary>
  private void ValidateLayout(UISchema schema, List<ValidationIssue> issues)
  {
    if (schema.Layout == null)
    {
      return; // Already flagged in basic structure validation
    }

    var inputParamIds = new HashSet<Guid>(schema.Inputs?.Select(i => i.Id) ?? Enumerable.Empty<Guid>());
    var outputParamIds = new HashSet<Guid>(schema.Outputs?.Select(o => o.Id) ?? Enumerable.Empty<Guid>());
    var layoutItemIds = new HashSet<string>();
    IEnumerable<LayoutItemBase> allItems = Enumerable.Empty<LayoutItemBase>();

    if (schema.Layout is TabbedLayoutConfig tabbedLayout)
    {
      if (tabbedLayout.Tabs == null || !tabbedLayout.Tabs.Any())
      {
        issues.Add(ValidationIssue.Warning(
          null,
          "Layout has no tabs defined",
          "Layout should contain at least one tab"));
        return;
      }

      foreach (var tab in tabbedLayout.Tabs)
      {
        if (string.IsNullOrEmpty(tab.Label))
        {
          issues.Add(ValidationIssue.Warning(
            null,
            "Tab has no label",
            "All tabs should have a label for user clarity"));
        }

        if (tab.Groups == null || !tab.Groups.Any())
        {
          issues.Add(ValidationIssue.Warning(
            null,
            $"Tab '{tab.Label}' has no groups",
            "Tabs should contain at least one group"));
          continue;
        }

        foreach (var group in tab.Groups)
        {
          ValidateGroup(group, inputParamIds, outputParamIds, layoutItemIds, issues);
        }
      }

      allItems = tabbedLayout.Tabs.SelectMany(t => t.Groups).SelectMany(g => g.Items);
    }
    else if (schema.Layout is FlatLayoutConfig flatLayout)
    {
      if (flatLayout.Groups == null || !flatLayout.Groups.Any())
      {
        issues.Add(ValidationIssue.Warning(
          null,
          "Layout has no groups defined",
          "Layout should contain at least one group"));
        return;
      }

      foreach (var group in flatLayout.Groups)
      {
        ValidateGroup(group, inputParamIds, outputParamIds, layoutItemIds, issues);
      }

      allItems = flatLayout.Groups.SelectMany(g => g.Items);
    }

    // Check for orphaned parameters (parameters not in layout)
    var usedParamIds = new HashSet<Guid>(allItems.Select(i => i.ParamId));

    var unusedInputs = inputParamIds.Except(usedParamIds).ToList();
    var unusedOutputs = outputParamIds.Except(usedParamIds).ToList();

    if (unusedInputs.Any())
    {
      issues.Add(ValidationIssue.Warning(
        null,
        $"Unused input parameters: {string.Join(", ", unusedInputs)}",
        "These input parameters are defined but not included in the layout"));
    }

    if (unusedOutputs.Any())
    {
      issues.Add(ValidationIssue.Warning(
        null,
        $"Unused output parameters: {string.Join(", ", unusedOutputs)}",
        "These output parameters are defined but not included in the layout"));
    }
  }

  private void ValidateGroup(
    GroupConfig group,
    HashSet<Guid> inputParamIds,
    HashSet<Guid> outputParamIds,
    HashSet<string> layoutItemIds,
    List<ValidationIssue> issues)
  {
    if (string.IsNullOrEmpty(group.Label))
    {
      issues.Add(ValidationIssue.Warning(
        null,
        "Group has no label",
        "All groups should have a label for user clarity"));
    }

    if (group.Items == null || !group.Items.Any())
    {
      issues.Add(ValidationIssue.Warning(
        null,
        $"Group '{group.Label}' has no items",
        "Groups should contain at least one item"));
      return;
    }

    // Validate column count
    if (group.Columns.HasValue && group.Columns.Value <= 0)
    {
      issues.Add(ValidationIssue.Error(
        null,
        $"Group '{group.Label}' has invalid column count: {group.Columns}",
        "Column count must be greater than 0"));
    }

    // Validate each item
    foreach (var item in group.Items)
    {
      ValidateLayoutItem(item, inputParamIds, outputParamIds, layoutItemIds, issues);
    }
  }

  /// <summary>
  ///   Validate a single layout item
  /// </summary>
  private void ValidateLayoutItem(
    LayoutItemBase item,
    HashSet<Guid> inputParamIds,
    HashSet<Guid> outputParamIds,
    HashSet<string> layoutItemIds,
    List<ValidationIssue> issues)
  {
    // Validate item ID
    if (string.IsNullOrEmpty(item.Id))
    {
      issues.Add(ValidationIssue.Error(
        item.ParamId.ToString(),
        "Layout item has empty ID",
        "All layout items must have a unique ID"));
      return;
    }

    // Check for duplicate layout item IDs
    if (!layoutItemIds.Add(item.Id))
    {
      issues.Add(ValidationIssue.Error(
        item.ParamId.ToString(),
        $"Duplicate layout item ID: {item.Id}",
        "Each layout item must have a unique ID"));
    }

    // Validate paramId
    if (item.ParamId == Guid.Empty)
    {
      issues.Add(ValidationIssue.Error(
        item.Id,
        $"Layout item {item.Id} has empty ParamId",
        "All layout items must reference a parameter via ParamId"));
      return;
    }

    // Validate parameter reference exists
    if (item.Type == "input")
    {
      if (!inputParamIds.Contains(item.ParamId))
      {
        issues.Add(ValidationIssue.Error(
          item.ParamId.ToString(),
          $"Layout item {item.Id} references non-existent input parameter: {item.ParamId}",
          "ParamId must reference an existing input parameter"));
      }
    }
    else if (item.Type == "output")
    {
      if (!outputParamIds.Contains(item.ParamId))
      {
        issues.Add(ValidationIssue.Error(
          item.ParamId.ToString(),
          $"Layout item {item.Id} references non-existent output parameter: {item.ParamId}",
          "ParamId must reference an existing output parameter"));
      }
    }

    // Validate span
    if (item.Span.HasValue && item.Span.Value <= 0)
    {
      issues.Add(ValidationIssue.Error(
        item.ParamId.ToString(),
        $"Layout item {item.Id} has invalid span: {item.Span}",
        "Span must be greater than 0"));
    }

    // Validate widget-specific configurations for input items
    ValidateLayoutItemConfig(item, issues);
  }

  /// <summary>
  ///   Validate widget configuration for layout items
  /// </summary>
  private void ValidateLayoutItemConfig(LayoutItemBase item, List<ValidationIssue> issues)
  {
    switch (item)
    {
      case InputNumberLayoutItem numberItem:
        ValidateNumberWidgetConfig(numberItem, issues);
        break;
      case InputDropdownLayoutItem dropdownItem:
        ValidateDropdownWidgetConfig(dropdownItem, issues);
        break;
        // Other widget types don't require special validation
    }
  }

  /// <summary>
  ///   Validate number widget configuration
  /// </summary>
  private void ValidateNumberWidgetConfig(InputNumberLayoutItem item, List<ValidationIssue> issues)
  {
    var config = item.Config;
    if (config == null)
    {
      issues.Add(ValidationIssue.Warning(
        item.ParamId.ToString(),
        $"Number widget for {item.DisplayName ?? item.ParamId.ToString()} has no configuration",
        "NumberWidgetConfig expected for number widget"));
      return;
    }

    // Validate min/max relationship
    if (config.Minimum.HasValue && config.Maximum.HasValue)
    {
      if (config.Minimum.Value >= config.Maximum.Value)
      {
        issues.Add(ValidationIssue.Error(
          item.ParamId.ToString(),
          $"Invalid min/max range for {item.DisplayName ?? item.ParamId.ToString()}: min ({config.Minimum}) >= max ({config.Maximum})",
          "Minimum value must be less than maximum value"));
      }
    }

    // Validate step size
    if (config.StepSize.HasValue)
    {
      if (config.StepSize.Value <= 0)
      {
        issues.Add(ValidationIssue.Error(
          item.ParamId.ToString(),
          $"Invalid step size for {item.DisplayName ?? item.ParamId.ToString()}: {config.StepSize}",
          "Step size must be greater than 0"));
      }

      // Warn if step size is too large for range
      if (config.Minimum.HasValue && config.Maximum.HasValue)
      {
        var range = config.Maximum.Value - config.Minimum.Value;
        if (config.StepSize.Value > range)
        {
          issues.Add(ValidationIssue.Warning(
            item.ParamId.ToString(),
            $"Step size ({config.StepSize}) larger than range ({range}) for {item.DisplayName ?? item.ParamId.ToString()}",
            "Step size should be smaller than the min/max range"));
        }
      }
    }
  }

  /// <summary>
  ///   Validate dropdown widget configuration
  /// </summary>
  private void ValidateDropdownWidgetConfig(InputDropdownLayoutItem item, List<ValidationIssue> issues)
  {
    var config = item.Config;
    if (config == null)
    {
      issues.Add(ValidationIssue.Error(
        item.ParamId.ToString(),
        $"Dropdown widget for {item.DisplayName ?? item.ParamId.ToString()} has no configuration",
        "DropdownWidgetConfig is required for dropdown widget"));
      return;
    }

    if (config.Options == null || !config.Options.Any())
    {
      issues.Add(ValidationIssue.Error(
        item.ParamId.ToString(),
        $"Dropdown {item.DisplayName ?? item.ParamId.ToString()} has no options defined",
        "DropdownWidgetConfig.Options must contain at least one option"));
    }
  }

  /// <summary>
  ///   Validate schema versioning information
  /// </summary>
  private void ValidateVersioning(UISchema schema, List<ValidationIssue> issues)
  {
    // Schema version
    if (string.IsNullOrEmpty(schema.SchemaVersion))
    {
      issues.Add(ValidationIssue.Warning(
        null,
        "Schema version is not set",
        "SchemaVersion should be set for proper migration handling"));
    }
    else
    {
      if (!Version.TryParse(schema.SchemaVersion, out _))
      {
        issues.Add(ValidationIssue.Error(
          null,
          $"Invalid schema version format: {schema.SchemaVersion}",
          "SchemaVersion must be a valid semantic version (e.g., '1.0.0')"));
      }
    }

    // Plugin version
    if (string.IsNullOrEmpty(schema.PluginVersion))
    {
      issues.Add(ValidationIssue.Info(
        null,
        "Plugin version is not set",
        "PluginVersion helps track which plugin version created this schema"));
    }
    else
    {
      if (!Version.TryParse(schema.PluginVersion, out _))
      {
        issues.Add(ValidationIssue.Warning(
          null,
          $"Invalid plugin version format: {schema.PluginVersion}",
          "PluginVersion should be a valid semantic version"));
      }
    }

    // Min plugin version
    if (!string.IsNullOrEmpty(schema.MinPluginVersion))
    {
      if (!Version.TryParse(schema.MinPluginVersion, out _))
      {
        issues.Add(ValidationIssue.Error(
          null,
          $"Invalid minimum plugin version format: {schema.MinPluginVersion}",
          "MinPluginVersion must be a valid semantic version"));
      }
    }
  }

  /// <summary>
  ///   Validate data constraints and business rules
  /// </summary>
  private void ValidateConstraints(UISchema schema, List<ValidationIssue> issues)
  {
    // Validate that at least one input or output exists
    if ((schema.Inputs == null || !schema.Inputs.Any()) &&
        (schema.Outputs == null || !schema.Outputs.Any()))
    {
      issues.Add(ValidationIssue.Warning(
        null,
        "Schema has no inputs or outputs",
        "Schema should define at least one input or output parameter"));
    }

    // Validate DocumentId format if present
    if (schema.DocumentId != Guid.Empty)
    {
      // DocumentId is already a Guid type, so it's always valid
      // Just check if it's set to a non-empty value
      // This validation is mainly informational
    }

    // Validate dates
    if (schema.Created == default)
    {
      issues.Add(ValidationIssue.Info(
        null,
        "Created timestamp is not set",
        "Schema.Created should be set to track creation time"));
    }

    if (schema.LastModified == default)
    {
      issues.Add(ValidationIssue.Info(
        null,
        "LastModified timestamp is not set",
        "Schema.LastModified should be updated when schema changes"));
    }

    if (schema.Created != default && schema.LastModified != default)
    {
      if (schema.LastModified < schema.Created)
      {
        issues.Add(ValidationIssue.Warning(
          null,
          "LastModified is earlier than Created",
          "LastModified timestamp should be equal to or later than Created"));
      }
    }
  }
}

/// <summary>
///   Result of schema validation
/// </summary>
public class ValidationResult
{
  public bool IsValid { get; set; }
  public List<ValidationIssue> Issues { get; set; } = new List<ValidationIssue>();

  public bool HasErrors => Issues.Any(i => i.Severity == ValidationSeverity.Error);
  public bool HasWarnings => Issues.Any(i => i.Severity == ValidationSeverity.Warning);

  public IEnumerable<ValidationIssue> Errors => Issues.Where(i => i.Severity == ValidationSeverity.Error);
  public IEnumerable<ValidationIssue> Warnings => Issues.Where(i => i.Severity == ValidationSeverity.Warning);
  public IEnumerable<ValidationIssue> Infos => Issues.Where(i => i.Severity == ValidationSeverity.Info);

  public static ValidationResult Success()
  {
    return new ValidationResult { IsValid = true };
  }

  public static ValidationResult Failure(string message)
  {
    return new ValidationResult
    {
      IsValid = false,
      Issues = new List<ValidationIssue>
      {
        ValidationIssue.Error(null, message)
      }
    };
  }
}

/// <summary>
///   Severity levels for validation issues
/// </summary>
public enum ValidationSeverity
{
  Info,
  Warning,
  Error
}

/// <summary>
///   Individual validation issue
/// </summary>
public class ValidationIssue
{
  public string ParamId { get; set; }
  public ValidationSeverity Severity { get; set; }
  public string Message { get; set; }
  public string Details { get; set; }

  public static ValidationIssue Error(string paramId, string message, string details = null)
  {
    return new ValidationIssue
    {
      ParamId = paramId,
      Severity = ValidationSeverity.Error,
      Message = message,
      Details = details
    };
  }

  public static ValidationIssue Warning(string paramId, string message, string details = null)
  {
    return new ValidationIssue
    {
      ParamId = paramId,
      Severity = ValidationSeverity.Warning,
      Message = message,
      Details = details
    };
  }

  public static ValidationIssue Info(string paramId, string message, string details = null)
  {
    return new ValidationIssue
    {
      ParamId = paramId,
      Severity = ValidationSeverity.Info,
      Message = message,
      Details = details
    };
  }

  public override string ToString()
  {
    var prefix = Severity switch
    {
      ValidationSeverity.Error => "ERROR",
      ValidationSeverity.Warning => "WARNING",
      ValidationSeverity.Info => "INFO",
      _ => "UNKNOWN"
    };

    var location = string.IsNullOrEmpty(ParamId) ? "" : $" ({ParamId})";
    var details = string.IsNullOrEmpty(Details) ? "" : $" - {Details}";

    return $"[{prefix}]{location}: {Message}{details}";
  }
}
