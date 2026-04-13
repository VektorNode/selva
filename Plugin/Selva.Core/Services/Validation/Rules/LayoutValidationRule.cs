using System;
using System.Collections.Generic;
using System.Linq;
using Selva.Core.Models;

namespace Selva.Core.Services.Validation.Rules;

/// <summary>
///   Validates layout structure and parameter references
/// </summary>
public class LayoutValidationRule : IValidationRule
{
	public IEnumerable<ValidationIssue> Validate(UISchema schema)
	{
		if (schema.Layout == null)
			yield break; // Already flagged in BasicStructureRule

		var inputParamIds = new HashSet<Guid>(schema.Inputs?.Select(i => i.Id) ?? Enumerable.Empty<Guid>());
		var outputParamIds = new HashSet<Guid>(schema.Outputs?.Select(o => o.Id) ?? Enumerable.Empty<Guid>());
		var layoutItemIds = new HashSet<string>();
		var allItems = new List<LayoutItemBase>();

		// Validate layout structure and collect items
		IEnumerable<ValidationIssue> structureIssues;
		if (schema.Layout is TabbedLayoutConfig tabbedLayout)
		{
			structureIssues = ValidateTabbedLayout(tabbedLayout, inputParamIds, outputParamIds, layoutItemIds, allItems);
		}
		else if (schema.Layout is FlatLayoutConfig flatLayout)
		{
			structureIssues = ValidateFlatLayout(flatLayout, inputParamIds, outputParamIds, layoutItemIds, allItems);
		}
		else
		{
			yield break;
		}

		foreach (var issue in structureIssues)
			yield return issue;

		// Check for orphaned parameters
		var usedParamIds = new HashSet<Guid>(allItems.Where(i => i.Type != "linebreak").Select(i => i.ParamId));
		var unusedInputs = inputParamIds.Except(usedParamIds).ToList();
		var unusedOutputs = outputParamIds.Except(usedParamIds).ToList();

		if (unusedInputs.Any())
			yield return ValidationIssue.Warning(
				null,
				$"Unused input parameters: {string.Join(", ", unusedInputs)}",
				"These input parameters are defined but not included in the layout");

		if (unusedOutputs.Any())
			yield return ValidationIssue.Warning(
				null,
				$"Unused output parameters: {string.Join(", ", unusedOutputs)}",
				"These output parameters are defined but not included in the layout");
	}

	private IEnumerable<ValidationIssue> ValidateTabbedLayout(
		TabbedLayoutConfig layout,
		HashSet<Guid> inputParamIds,
		HashSet<Guid> outputParamIds,
		HashSet<string> layoutItemIds,
		List<LayoutItemBase> allItems)
	{
		if (layout.Tabs == null || !layout.Tabs.Any())
		{
			yield return ValidationIssue.Warning(
				null,
				"Layout has no tabs defined",
				"Layout should contain at least one tab");
			yield break;
		}

		foreach (var tab in layout.Tabs)
		{
			if (string.IsNullOrEmpty(tab.Label))
				yield return ValidationIssue.Warning(
					null,
					"Tab has no label",
					"All tabs should have a label for user clarity");

			if (tab.Groups == null || !tab.Groups.Any())
			{
				yield return ValidationIssue.Warning(
					null,
					$"Tab '{tab.Label}' has no groups",
					"Tabs should contain at least one group");
				continue;
			}

			foreach (var group in tab.Groups)
			{
				foreach (var issue in ValidateGroup(group, inputParamIds, outputParamIds, layoutItemIds))
					yield return issue;

				if (group.Items != null)
					allItems.AddRange(group.Items);
			}
		}
	}

	private IEnumerable<ValidationIssue> ValidateFlatLayout(
		FlatLayoutConfig layout,
		HashSet<Guid> inputParamIds,
		HashSet<Guid> outputParamIds,
		HashSet<string> layoutItemIds,
		List<LayoutItemBase> allItems)
	{
		if (layout.Groups == null || !layout.Groups.Any())
		{
			yield return ValidationIssue.Warning(
				null,
				"Layout has no groups defined",
				"Layout should contain at least one group");
			yield break;
		}

		foreach (var group in layout.Groups)
		{
			foreach (var issue in ValidateGroup(group, inputParamIds, outputParamIds, layoutItemIds))
				yield return issue;

			if (group.Items != null)
				allItems.AddRange(group.Items);
		}
	}

	private IEnumerable<ValidationIssue> ValidateGroup(
		GroupConfig group,
		HashSet<Guid> inputParamIds,
		HashSet<Guid> outputParamIds,
		HashSet<string> layoutItemIds)
	{
		if (string.IsNullOrEmpty(group.Label))
			yield return ValidationIssue.Warning(
				null,
				"Group has no label",
				"All groups should have a label for user clarity");

		if (group.Items == null || !group.Items.Any())
		{
			yield return ValidationIssue.Warning(
				null,
				$"Group '{group.Label}' has no items",
				"Groups should contain at least one item");
			yield break;
		}

		if (group.Columns.HasValue && group.Columns.Value <= 0)
			yield return ValidationIssue.Error(
				null,
				$"Group '{group.Label}' has invalid column count: {group.Columns}",
				"Column count must be greater than 0");

		foreach (var item in group.Items)
		{
			foreach (var issue in ValidateLayoutItem(item, inputParamIds, outputParamIds, layoutItemIds))
				yield return issue;
		}
	}

	private IEnumerable<ValidationIssue> ValidateLayoutItem(
		LayoutItemBase item,
		HashSet<Guid> inputParamIds,
		HashSet<Guid> outputParamIds,
		HashSet<string> layoutItemIds)
	{
		if (string.IsNullOrEmpty(item.Id))
		{
			yield return ValidationIssue.Error(
				item.ParamId.ToString(),
				"Layout item has empty ID",
				"All layout items must have a unique ID");
			yield break;
		}

		if (!layoutItemIds.Add(item.Id))
			yield return ValidationIssue.Error(
				item.ParamId.ToString(),
				$"Duplicate layout item ID: {item.Id}",
				"Each layout item must have a unique ID");

		// Line break items have no parameter reference — skip param validation
		if (item.Type == "linebreak")
			yield break;

		if (item.ParamId == Guid.Empty)
		{
			yield return ValidationIssue.Error(
				item.Id,
				$"Layout item {item.Id} has empty ParamId",
				"All layout items must reference a parameter via ParamId");
			yield break;
		}

		// Validate parameter reference exists
		if (item.Type == "input")
		{
			if (!inputParamIds.Contains(item.ParamId))
				yield return ValidationIssue.Error(
					item.ParamId.ToString(),
					$"Layout item {item.Id} references non-existent input parameter: {item.ParamId}",
					"ParamId must reference an existing input parameter");
		}
		else if (item.Type == "output")
		{
			if (!outputParamIds.Contains(item.ParamId))
				yield return ValidationIssue.Error(
					item.ParamId.ToString(),
					$"Layout item {item.Id} references non-existent output parameter: {item.ParamId}",
					"ParamId must reference an existing output parameter");
		}

		if (item.Span.HasValue && item.Span.Value <= 0)
			yield return ValidationIssue.Error(
				item.ParamId.ToString(),
				$"Layout item {item.Id} has invalid span: {item.Span}",
				"Span must be greater than 0");
	}
}
