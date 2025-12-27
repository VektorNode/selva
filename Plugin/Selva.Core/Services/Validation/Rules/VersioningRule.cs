using System;
using System.Collections.Generic;
using Selva.Core.Models;

namespace Selva.Core.Services.Validation.Rules;

/// <summary>
///   Validates schema versioning information
/// </summary>
public class VersioningRule : IValidationRule
{
	public IEnumerable<ValidationIssue> Validate(UISchema schema)
	{
		// Schema version
		if (string.IsNullOrEmpty(schema.SchemaVersion))
		{
			yield return ValidationIssue.Warning(
				null,
				"Schema version is not set",
				"SchemaVersion should be set for proper migration handling");
		}
		else
		{
			if (!Version.TryParse(schema.SchemaVersion, out _))
				yield return ValidationIssue.Error(
					null,
					$"Invalid schema version format: {schema.SchemaVersion}",
					"SchemaVersion must be a valid semantic version (e.g., '1.0.0')");
		}

		// Plugin version
		if (string.IsNullOrEmpty(schema.PluginVersion))
		{
			yield return ValidationIssue.Info(
				null,
				"Plugin version is not set",
				"PluginVersion helps track which plugin version created this schema");
		}
		else
		{
			if (!Version.TryParse(schema.PluginVersion, out _))
				yield return ValidationIssue.Warning(
					null,
					$"Invalid plugin version format: {schema.PluginVersion}",
					"PluginVersion should be a valid semantic version");
		}

		// Min plugin version
		if (!string.IsNullOrEmpty(schema.MinPluginVersion))
		{
			if (!Version.TryParse(schema.MinPluginVersion, out _))
				yield return ValidationIssue.Error(
					null,
					$"Invalid minimum plugin version format: {schema.MinPluginVersion}",
					"MinPluginVersion must be a valid semantic version");
		}
	}
}
