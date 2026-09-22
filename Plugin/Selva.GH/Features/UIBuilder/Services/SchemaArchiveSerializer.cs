using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;
using Selva.Schema.Services;
using Selva.GH.Utilities.Guards;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Serializes schema and values to/from a .gh file's GH_IWriter/GH_IReader archive.
/// </summary>
public class SchemaArchiveSerializer
{
    private static readonly JsonSerializerSettings SchemaSerializationSettings = new JsonSerializerSettings
    {
        NullValueHandling = NullValueHandling.Ignore,
        DefaultValueHandling = DefaultValueHandling.Ignore
    };

    private readonly Version _pluginVersion;

    /// <param name="pluginVersion">Current plugin version, used to migrate older saved schemas.</param>
    public SchemaArchiveSerializer(Version pluginVersion)
    {
        _pluginVersion = pluginVersion ?? throw new ArgumentNullException(nameof(pluginVersion));
    }

    public bool SerializeToArchive(GH_IWriter writer, UISchema schema, Dictionary<string, object> values)
    {
        if (writer == null)
        {
            throw new ArgumentNullException(nameof(writer));
        }

        try
        {
            if (schema != null)
            {
                if (string.IsNullOrEmpty(schema.SchemaVersion))
                {
                    schema.SchemaVersion = SchemaVersion.CURRENT_STRING;
                }

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

    public (UISchema schema, Dictionary<string, object> values, string migrationMessage)?
        DeserializeFromArchive(GH_IReader reader)
    {
        if (reader == null)
        {
            throw new ArgumentNullException(nameof(reader));
        }

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
                    // Parsed as JObject (not deserialized directly) so SchemaMigrator can apply
                    // structural JSON changes before the shape is locked to UISchema.
                    var jObject = JObject.Parse(schemaJson);

                    var originalVersion = jObject["schemaVersion"]?.Value<string>();
                    var needsBackup = string.IsNullOrEmpty(originalVersion) ||
                                      Version.Parse(originalVersion ?? "1.0.0") < SchemaVersion.CURRENT;

                    // Skip backup writes when running under Rhino.Compute: the
                    // .gh file isn't being mutated there, and concurrent compute
                    // workers race on the second-precision backup filename.
                    if (needsBackup && HeadlessGuard.IsHeadless)
                    {
                        needsBackup = false;
                    }

                    // Back up the raw JSON before migration mutates it.
                    if (needsBackup)
                    {
                        var schemaName = jObject["name"]?.Value<string>() ?? jObject["id"]?.Value<string>();
                        var backupPath = SchemaBackupService.CreateMigrationBackup(
                            schemaJson,
                            schemaName,
                            originalVersion,
                            Logger.Warn
                        );
                        if (!string.IsNullOrEmpty(backupPath))
                        {
                            migrationMessage = $"Backup created at: {backupPath}\n";
                        }
                    }

                    jObject = SchemaMigrator.MigrateJson(jObject);
                    var rawSchema = jObject.ToObject<UISchema>();
                    schema = SchemaMigrator.MigrateToCurrentVersion(rawSchema, _pluginVersion);

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

        if (schema != null || values != null)
        {
            return (schema, values, migrationMessage);
        }

        return null;
    }
}
