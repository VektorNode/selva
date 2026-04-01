using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.Core.Constants;
using Selva.Core.Models;

namespace Selva.Core.Services;

/// <summary>
///   Handles schema migration across versions
/// </summary>
public static class SchemaMigrator
{
	/// <summary>
	///   Current version of the plugin's schema format.
	///   This is now a reference to the centralized version constant.
	/// </summary>
	[Obsolete("Use SchemaVersion.CURRENT instead", false)]
	public static readonly Version CURRENT_SCHEMA_VERSION = SchemaVersion.CURRENT;

	// Migration registry: maps version -> migration function
	private static readonly Dictionary<Version, Func<UISchema, UISchema>> _migrations =
		new()
		{
			{ new Version(2, 0, 0), MigrateTo_2_0_0 },
			{ new Version(2, 3, 0), MigrateTo_2_3_0 },
			{ SchemaVersion.CURRENT, MigrateTo_2_4_0 }
		};

	/// <summary>
	///   Pre-deserialization migration for structural changes that cannot be handled by the C# model
	/// </summary>
	public static JObject MigrateJson(JObject json)
	{
		var versionStr = json["schemaVersion"]?.Value<string>();
		// Handle legacy schemas without version
		if (string.IsNullOrEmpty(versionStr))
		{
			versionStr = "1.0.0";
			json["schemaVersion"] = versionStr;
		}

		var version = Version.Parse(versionStr);

		if (version < SchemaVersion.CURRENT)
		{
			// Migration to current version:
			var layout = json["layout"] as JObject;
			if (layout != null)
			{
				// 1. Ensure 'type' discriminator exists (required for v2 polymorphism)
				var type = layout["type"]?.Value<string>();
				if (string.IsNullOrEmpty(type))
				{
					// Infer type from structure or default to tabbed (v1 default)
					if (layout["tabs"] != null)
						type = "tabbed";
					else if (layout["groups"] != null)
						type = "flat";
					else
						type = "tabbed"; // Default
					layout["type"] = type;
				}

				// 2. Handle Flat Layout structural change (tabs -> groups)
				if (type == "flat")
				{
					var tabs = layout["tabs"] as JArray;
					if (tabs != null)
					{
						var allGroups = new JArray();
						foreach (var tab in tabs)
						{
							var groups = tab["groups"] as JArray;
							if (groups != null)
								foreach (var group in groups)
									allGroups.Add(group);
						}

						layout["groups"] = allGroups;
						layout.Remove("tabs");
					}
				}
			}

			// Update version
			json["schemaVersion"] = SchemaVersion.CURRENT_STRING;
		}

		return json;
	}

	private static UISchema MigrateTo_2_0_0(UISchema schema)
	{
		schema.SchemaVersion = "2.0.0";

		// Name field removed in 2.0.0 - now only using nickname

		return schema;
	}

	private static UISchema MigrateTo_2_3_0(UISchema schema)
	{
		schema.SchemaVersion = "2.3.0";

		// inputStructure added in 2.3.0 - defaults to "item" for all existing inputs
		// No explicit migration needed; the C# model defaults to "item" on deserialization.

		return schema;
	}

	private static UISchema MigrateTo_2_4_0(UISchema schema)
	{
		schema.SchemaVersion = SchemaVersion.CURRENT_STRING;

		// OutputChartLayoutItem added in 2.4.0 - fully backward-compatible addition.
		// No data transformation needed; existing schemas without chart outputs load unchanged.

		return schema;
	}

	/// <summary>
	///   Migrate schema to current version
	/// </summary>
	public static UISchema MigrateToCurrentVersion(UISchema schema, Version currentPluginVersion)
	{
		var (migratedSchema, _) = MigrateWithTracking(schema, currentPluginVersion);
		return migratedSchema;
	}

	/// <summary>
	///   Migrate schema to current version with change tracking
	/// </summary>
	public static (UISchema Schema, List<string> Changes) MigrateWithTracking(UISchema schema,
		Version currentPluginVersion)
	{
		if (schema == null) throw new ArgumentNullException(nameof(schema));

		var changes = new List<string>();

		// Handle legacy schemas without version
		if (string.IsNullOrEmpty(schema.SchemaVersion))
		{
			schema.SchemaVersion = "1.0.0";
			changes.Add("Set schema version to 1.0.0 (legacy schema detected)");
		}

		Version schemaVersion;
		try
		{
			schemaVersion = Version.Parse(schema.SchemaVersion);
		}
		catch (Exception ex)
		{
			throw new IncompatibleSchemaException($"Invalid schema version format '{schema.SchemaVersion}': {ex.Message}");
		}

		// Validate minimum plugin version compatibility
		if (!string.IsNullOrEmpty(schema.MinPluginVersion))
		{
			Version minVersion;
			try
			{
				minVersion = Version.Parse(schema.MinPluginVersion);
			}
			catch (Exception ex)
			{
				throw new IncompatibleSchemaException(
					$"Invalid minimum plugin version format '{schema.MinPluginVersion}': {ex.Message}");
			}

			if (currentPluginVersion < minVersion)
				throw new IncompatibleSchemaException(
					$"This schema requires plugin version {minVersion} or higher. Current version: {currentPluginVersion}");
		}

		// No migration needed if already at current version
		if (schemaVersion >= SchemaVersion.CURRENT) return (schema, changes);

		var migratedSchema = schema;
		var migrationPath = GetMigrationPath(schemaVersion, SchemaVersion.CURRENT);

		// Apply migrations in order
		foreach (var targetVersion in migrationPath)
			if (_migrations.TryGetValue(targetVersion, out var migration))
			{
				try
				{
					var before = migratedSchema.SchemaVersion;
					migratedSchema = migration(migratedSchema);
					changes.Add($"Applied migration from {before} to {targetVersion}");
				}
				catch (Exception ex)
				{
					throw new SchemaMigrationException($"Migration to {targetVersion} failed: {ex.Message}", ex);
				}
			}
			else
			{
				migratedSchema.SchemaVersion = targetVersion.ToString();
				changes.Add($"Updated version to {targetVersion} (no data changes)");
			}

		migratedSchema.SchemaVersion = SchemaVersion.CURRENT.ToString();
		migratedSchema.LastModified = DateTime.UtcNow;

		return (migratedSchema, changes);
	}

	public static List<Version> GetMigrationPath(Version from, Version to)
	{
		return _migrations.Keys
			.Where(v => v > from && v <= to)
			.OrderBy(v => v)
			.ToList();
	}

	public static (bool Success, List<string> Issues) ValidateMigration(UISchema schema, Version currentPluginVersion)
	{
		if (schema == null) return (false, new List<string> { "Schema is null" });

		var issues = new List<string>();

		if (string.IsNullOrEmpty(schema.SchemaVersion))
		{
			issues.Add("Legacy schema without version - will be migrated to 1.0.0");
		}
		else
		{
			if (!Version.TryParse(schema.SchemaVersion, out var schemaVersion))
				return (false, new List<string> { $"Invalid schema version format: {schema.SchemaVersion}" });

			if (schemaVersion >= SchemaVersion.CURRENT)
			{
				issues.Add("Schema is already at current version - no migration needed");
				return (true, issues);
			}

			var migrationPath = GetMigrationPath(schemaVersion, SchemaVersion.CURRENT);
			if (migrationPath.Any())
			{
				issues.Add($"Migration path: {string.Join(" -> ", migrationPath)}");
				foreach (var version in migrationPath)
					issues.Add(_migrations.ContainsKey(version)
						? $"✓ Migration to {version} available"
						: $"⚠ No explicit migration for {version} (version update only)");
			}
		}

		if (!string.IsNullOrEmpty(schema.MinPluginVersion))
		{
			if (!Version.TryParse(schema.MinPluginVersion, out var minVersion))
				return (false, new List<string> { $"Invalid minimum plugin version format: {schema.MinPluginVersion}" });

			if (currentPluginVersion < minVersion)
				return (false,
					new List<string>
					{
						$"Incompatible: Schema requires plugin version {minVersion}, current version is {currentPluginVersion}"
					});
		}

		return (true, issues);
	}

	public static bool NeedsMigration(UISchema schema)
	{
		if (schema == null || string.IsNullOrEmpty(schema.SchemaVersion)) return true;

		try
		{
			return Version.Parse(schema.SchemaVersion) < SchemaVersion.CURRENT;
		}
		catch
		{
			return true;
		}
	}

	public static (bool IsCompatible, string Message) ValidateCompatibility(UISchema schema, Version currentPluginVersion)
	{
		if (schema == null) return (false, "Schema is null");

		if (string.IsNullOrEmpty(schema.SchemaVersion)) return (true, "Legacy schema detected - will be migrated on load");

		if (!Version.TryParse(schema.SchemaVersion, out var schemaVersion)) return (false, "Invalid schema version format");

		if (!string.IsNullOrEmpty(schema.MinPluginVersion))
		{
			if (!Version.TryParse(schema.MinPluginVersion, out var minVersion))
				return (false, "Invalid minimum plugin version format");

			if (currentPluginVersion < minVersion)
				return (false, $"Schema requires plugin version {minVersion} or higher. Current: {currentPluginVersion}");
		}

		if (schemaVersion.Major > SchemaVersion.CURRENT.Major)
			return (false, $"Schema version {schemaVersion} requires a newer version of Selva");

		return (true, "Schema is compatible");
	}
}

public class IncompatibleSchemaException : Exception
{
	public IncompatibleSchemaException(string message) : base(message)
	{
	}
}

public class SchemaMigrationException : Exception
{
	public SchemaMigrationException(string message, Exception inner) : base(message, inner)
	{
	}
}
