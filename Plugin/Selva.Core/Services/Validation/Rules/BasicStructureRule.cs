using System.Collections.Generic;
using Selva.Core.Models;

namespace Selva.Core.Services.Validation.Rules;

/// <summary>
///   Validates that all required top-level schema fields are present
/// </summary>
public class BasicStructureRule : IValidationRule
{
	public IEnumerable<ValidationIssue> Validate(UISchema schema)
	{
		if (string.IsNullOrEmpty(schema.Id))
			yield return ValidationIssue.Error(
				null,
				"Schema ID is required",
				"UISchema.Id must be a non-empty string");

		if (string.IsNullOrEmpty(schema.Name))
			yield return ValidationIssue.Error(
				null,
				"Schema name is required",
				"UISchema.Name must be a non-empty string");

		if (schema.Inputs == null)
			yield return ValidationIssue.Error(
				null,
				"Inputs array is null",
				"UISchema.Inputs must be an array (can be empty)");

		if (schema.Outputs == null)
			yield return ValidationIssue.Error(
				null,
				"Outputs array is null",
				"UISchema.Outputs must be an array (can be empty)");

		if (schema.Layout == null)
			yield return ValidationIssue.Error(
				null,
				"Layout is null",
				"UISchema.Layout must be defined");
	}
}
