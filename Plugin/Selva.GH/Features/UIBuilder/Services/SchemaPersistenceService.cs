using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Core.Constants;
using Selva.Core.Models;
using Selva.Core.Services;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
/// Handles schema and values serialization/deserialization for persistence in .gh files.
/// </summary>
public class SchemaPersistenceService
{
	private static readonly JsonSerializerSettings SchemaSerializationSettings = new()
	{
		NullValueHandling = NullValueHandling.Ignore,
		DefaultValueHandling = DefaultValueHandling.Ignore
	};

	private readonly Version _pluginVersion;

	/// <summary>
	/// Creates a new instance of SchemaPersistenceService.
	/// </summary>
	/// <param name="pluginVersion">The current plugin version for schema migration.</param>
	public SchemaPersistenceService(Version pluginVersion)
	{
		_pluginVersion = pluginVersion ?? throw new ArgumentNullException(nameof(pluginVersion));
	}

	public bool SerializeToArchive(GH_IWriter writer, UISchema schema, Dictionary<string, object> values)
	{
		if (writer == null) throw new ArgumentNullException(nameof(writer));

		try
		{
			if (schema != null)
			{
				// Ensure version is set before saving
				if (string.IsNullOrEmpty(schema.SchemaVersion))
					schema.SchemaVersion = SchemaVersion.CURRENT_STRING;

				schema.LastModified = DateTime.UtcNow;

				var schemaJson = JsonConvert.SerializeObject(schema, SchemaSerializationSettings);
				writer.SetString("Schema", schemaJson);
			}

			if (values != null && values.Count > 0)
			{
				var valuesJson = JsonConvert.SerializeObject(values);
				writer.SetString("Values", valuesJson);
			}

			return true;
		}
		catch (Exception ex)
		{
			throw new InvalidOperationException($"Failed to serialize schema: {ex.Message}", ex);
		}
	}

	public (UISchema schema, Dictionary<string, object> values)? DeserializeFromArchive(GH_IReader reader)
	{
		if (reader == null) throw new ArgumentNullException(nameof(reader));

		UISchema schema = null;
		Dictionary<string, object> values = null;
		string migrationMessage = null;

		if (reader.ItemExists("Schema"))
		{
			try
			{
				var schemaJson = reader.GetString("Schema");
				if (!string.IsNullOrEmpty(schemaJson))
				{
					// Parse as JObject first to handle structural migrations
					var jObject = JObject.Parse(schemaJson);

					// CAPTURE ORIGINAL VERSION BEFORE MIGRATION
					var originalVersion = jObject["schemaVersion"]?.Value<string>();
					bool needsBackup = string.IsNullOrEmpty(originalVersion) ||
					                   Version.Parse(originalVersion ?? "1.0.0") < SchemaVersion.CURRENT;

					// CREATE BACKUP from raw JSON before any migration or deserialization
					if (needsBackup)
					{
						var schemaName = jObject["name"]?.Value<string>() ?? jObject["id"]?.Value<string>();
						var backupPath = SchemaBackupService.CreateMigrationBackup(
							schemaJson,
							schemaName,
							originalVersion,
							onWarning: Logger.Warn
						);
						if (!string.IsNullOrEmpty(backupPath))
							migrationMessage = $"Backup created at: {backupPath}\n";
					}

					// Run JSON-level migration (structural changes)
					jObject = SchemaMigrator.MigrateJson(jObject);

					// Deserialize the migrated JSON
					var rawSchema = jObject.ToObject<UISchema>();

					// MIGRATE TO CURRENT VERSION (Logic/Defaults)
					schema = SchemaMigrator.MigrateToCurrentVersion(rawSchema, _pluginVersion);

					// Track migration for reporting
					if (originalVersion != schema.SchemaVersion)
					{
						var msg = $"Schema migrated from v{originalVersion ?? "legacy"} to v{schema.SchemaVersion}";
						migrationMessage = migrationMessage != null ? migrationMessage + msg : msg;
					}
				}
			}
			catch (IncompatibleSchemaException ex)
			{
				throw new InvalidOperationException($"Incompatible schema: {ex.Message}", ex);
			}
			catch (Exception ex)
			{
				throw new InvalidOperationException($"Failed to deserialize schema: {ex.Message}", ex);
			}
		}

		if (reader.ItemExists("Values"))
		{
			try
			{
				var valuesJson = reader.GetString("Values");
				if (!string.IsNullOrEmpty(valuesJson))
				{
					values = JsonConvert.DeserializeObject<Dictionary<string, object>>(valuesJson);
				}
			}
			catch (Exception ex)
			{
				throw new InvalidOperationException($"Failed to deserialize values: {ex.Message}", ex);
			}
		}

		// If we have schema or values, return them along with any migration message
		if (schema != null || values != null)
		{
			return (schema, values);
		}

		return null;
	}
}
