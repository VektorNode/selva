using System;
using System.Collections.Generic;
using System.Linq;
using Selva.Core.Models;

namespace Selva.Core.Services.Validation.Rules;

/// <summary>
///   Validates data constraints and business rules
/// </summary>
public class ConstraintsRule : IValidationRule
{
	public IEnumerable<ValidationIssue> Validate(UISchema schema)
	{
		// Validate that at least one input or output exists
		if ((schema.Inputs == null || !schema.Inputs.Any()) &&
		    (schema.Outputs == null || !schema.Outputs.Any()))
		{
			yield return ValidationIssue.Warning(
				null,
				"Schema has no inputs or outputs",
				"Schema should define at least one input or output parameter");
		}

		// Validate dates
		if (schema.Created == default)
			yield return ValidationIssue.Info(
				null,
				"Created timestamp is not set",
				"Schema.Created should be set to track creation time");

		if (schema.LastModified == default)
			yield return ValidationIssue.Info(
				null,
				"LastModified timestamp is not set",
				"Schema.LastModified should be updated when schema changes");

		if (schema.Created != default && schema.LastModified != default)
		{
			if (schema.LastModified < schema.Created)
				yield return ValidationIssue.Warning(
					null,
					"LastModified is earlier than Created",
					"LastModified timestamp should be equal to or later than Created");
		}
	}
}
