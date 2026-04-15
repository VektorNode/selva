using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Selva.Core.Models;

namespace Selva.Core.Services.Validation.Rules;

/// <summary>
///     Validates widget-specific configurations for layout items
/// </summary>
public class WidgetConfigRule : IValidationRule
{
    public IEnumerable<ValidationIssue> Validate(UISchema schema)
    {
        if (schema.Layout == null)
        {
            yield break;
        }

        var allItems = GetAllLayoutItems(schema.Layout);

        foreach (var item in allItems)
        {
            foreach (var issue in ValidateWidgetConfig(item))
            {
                yield return issue;
            }
        }
    }

    private IEnumerable<LayoutItemBase> GetAllLayoutItems(LayoutConfigBase layout)
    {
        if (layout is TabbedLayoutConfig tabbedLayout)
        {
            return tabbedLayout.Tabs?
                       .SelectMany(t => t.Groups)
                       .SelectMany(g => g.Items ?? Enumerable.Empty<LayoutItemBase>())
                   ?? Enumerable.Empty<LayoutItemBase>();
        }

        if (layout is FlatLayoutConfig flatLayout)
        {
            return flatLayout.Groups?
                       .SelectMany(g => g.Items ?? Enumerable.Empty<LayoutItemBase>())
                   ?? Enumerable.Empty<LayoutItemBase>();
        }

        return Enumerable.Empty<LayoutItemBase>();
    }

    private IEnumerable<ValidationIssue> ValidateWidgetConfig(LayoutItemBase item)
    {
        switch (item)
        {
            case InputNumberLayoutItem numberItem:
                foreach (var issue in ValidateNumberWidget(numberItem))
                {
                    yield return issue;
                }

                break;
            case InputDropdownLayoutItem dropdownItem:
                foreach (var issue in ValidateDropdownWidget(dropdownItem))
                {
                    yield return issue;
                }

                break;
            case InputTextLayoutItem textItem:
                foreach (var issue in ValidateTextWidget(textItem))
                {
                    yield return issue;
                }

                break;
        }
    }

    private IEnumerable<ValidationIssue> ValidateNumberWidget(InputNumberLayoutItem item)
    {
        var config = item.Config;
        if (config == null)
        {
            yield return ValidationIssue.Warning(
                item.ParamId.ToString(),
                $"Number widget for {item.DisplayName ?? item.ParamId.ToString()} has no configuration",
                "NumberWidgetConfig expected for number widget");
            yield break;
        }

        // Validate min/max relationship
        if (config.Minimum.HasValue && config.Maximum.HasValue)
        {
            if (config.Minimum.Value >= config.Maximum.Value)
            {
                yield return ValidationIssue.Error(
                    item.ParamId.ToString(),
                    $"Invalid min/max range for {item.DisplayName ?? item.ParamId.ToString()}: min ({config.Minimum}) >= max ({config.Maximum})",
                    "Minimum value must be less than maximum value");
            }
        }

        // Validate step size
        if (config.StepSize.HasValue)
        {
            if (config.StepSize.Value <= 0)
            {
                yield return ValidationIssue.Error(
                    item.ParamId.ToString(),
                    $"Invalid step size for {item.DisplayName ?? item.ParamId.ToString()}: {config.StepSize}",
                    "Step size must be greater than 0");
            }

            // Warn if step size is too large for range
            if (config.Minimum.HasValue && config.Maximum.HasValue)
            {
                var range = config.Maximum.Value - config.Minimum.Value;
                if (config.StepSize.Value > range)
                {
                    yield return ValidationIssue.Warning(
                        item.ParamId.ToString(),
                        $"Step size ({config.StepSize}) larger than range ({range}) for {item.DisplayName ?? item.ParamId.ToString()}",
                        "Step size should be smaller than the min/max range");
                }
            }
        }
    }

    private IEnumerable<ValidationIssue> ValidateDropdownWidget(InputDropdownLayoutItem item)
    {
        var config = item.Config;
        if (config == null)
        {
            yield return ValidationIssue.Error(
                item.ParamId.ToString(),
                $"Dropdown widget for {item.DisplayName ?? item.ParamId.ToString()} has no configuration",
                "DropdownWidgetConfig is required for dropdown widget");
            yield break;
        }

        if (config.Options == null || !config.Options.Any())
        {
            yield return ValidationIssue.Error(
                item.ParamId.ToString(),
                $"Dropdown {item.DisplayName ?? item.ParamId.ToString()} has no options defined",
                "DropdownWidgetConfig.Options must contain at least one option");
        }
    }

    private IEnumerable<ValidationIssue> ValidateTextWidget(InputTextLayoutItem item)
    {
        if (item.Config == null)
        {
            yield break;
        }

        var config = item.Config;

        // Validate maxLength
        if (config.MaxLength.HasValue && config.MaxLength.Value < 1)
        {
            yield return ValidationIssue.Error(
                item.ParamId.ToString(),
                $"Text input '{item.DisplayName ?? item.ParamId.ToString()}': maxLength must be positive",
                $"maxLength is {config.MaxLength.Value} but must be at least 1");
        }

        // Validate regex pattern
        if (!string.IsNullOrEmpty(config.Pattern))
        {
            ValidationIssue patternError = null;
            try
            {
                _ = new Regex(config.Pattern);
            }
            catch (Exception ex)
            {
                patternError = ValidationIssue.Error(
                    item.ParamId.ToString(),
                    $"Text input '{item.DisplayName ?? item.ParamId.ToString()}': invalid regex pattern - {ex.Message}",
                    $"Pattern: {config.Pattern}");
            }

            if (patternError != null)
            {
                yield return patternError;
            }
        }
    }
}
