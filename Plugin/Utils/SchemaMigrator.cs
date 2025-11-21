using System;
using ComputeBuilder.Plugin.Models.Generated;

namespace ComputeBuilder.Utils
{
    /// <summary>
    ///     Handles schema migration across versions
    /// </summary>
    public static class SchemaMigrator
    {
        // Current version of the plugin's schema format
        public static readonly Version CURRENT_SCHEMA_VERSION = new Version(1, 0, 0);
        public static readonly Version PLUGIN_VERSION = new Version(1, 0, 0);

        /// <summary>
        ///     Migrate schema to current version
        /// </summary>
        public static UISchema MigrateToCurrentVersion(UISchema schema)
        {
            if (schema == null)
            {
                throw new ArgumentNullException(nameof(schema));
            }

            // Handle legacy schemas without version
            if (string.IsNullOrEmpty(schema.SchemaVersion))
            {
                schema.SchemaVersion = "1.0.0";
            }

            Version schemaVersion;
            try
            {
                schemaVersion = Version.Parse(schema.SchemaVersion);
            }
            catch (Exception ex)
            {
                throw new IncompatibleSchemaException(
                    $"Invalid schema version format '{schema.SchemaVersion}': {ex.Message}");
            }

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

                if (PLUGIN_VERSION < minVersion)
                {
                    throw new IncompatibleSchemaException(
                        $"This schema requires plugin version {minVersion} or higher. " +
                        $"Current version: {PLUGIN_VERSION}");
                }
            }

            if (schemaVersion >= CURRENT_SCHEMA_VERSION)
            {
                return schema;
            }

            var migratedSchema = schema;

            // Example migration: if (schemaVersion < new Version(1, 1, 0))
            // {
            //     migratedSchema = MigrateTo_1_1_0(migratedSchema);
            // }

            migratedSchema.SchemaVersion = CURRENT_SCHEMA_VERSION.ToString();
            migratedSchema.LastModified = DateTime.UtcNow;

            return migratedSchema;
        }

        /// <summary>
        ///     Check if a schema needs migration
        /// </summary>
        public static bool NeedsMigration(UISchema schema)
        {
            if (schema == null || string.IsNullOrEmpty(schema.SchemaVersion))
            {
                return true; // Legacy schema
            }

            try
            {
                var schemaVersion = Version.Parse(schema.SchemaVersion);
                return schemaVersion < CURRENT_SCHEMA_VERSION;
            }
            catch
            {
                return true;
            }
        }

        /// <summary>
        ///     Validate schema version compatibility without migrating
        /// </summary>
        public static (bool IsCompatible, string Message) ValidateCompatibility(UISchema schema)
        {
            if (schema == null)
            {
                return (false, "Schema is null");
            }

            if (string.IsNullOrEmpty(schema.SchemaVersion))
            {
                return (true, "Legacy schema detected - will be migrated on load");
            }

            Version schemaVersion;
            try
            {
                schemaVersion = Version.Parse(schema.SchemaVersion);
            }
            catch (Exception ex)
            {
                return (false, $"Invalid schema version format: {ex.Message}");
            }

            if (!string.IsNullOrEmpty(schema.MinPluginVersion))
            {
                Version minVersion;
                try
                {
                    minVersion = Version.Parse(schema.MinPluginVersion);
                }
                catch (Exception ex)
                {
                    return (false, $"Invalid minimum plugin version format: {ex.Message}");
                }

                if (PLUGIN_VERSION < minVersion)
                {
                    return (false,
                        $"Schema requires plugin version {minVersion} or higher. Current: {PLUGIN_VERSION}");
                }
            }

            if (schemaVersion.Major > CURRENT_SCHEMA_VERSION.Major)
            {
                return (false,
                    $"Schema version {schemaVersion} requires a newer version of ComputeBuilder");
            }

            return (true, "Schema is compatible");
        }

        // Example migration methods (add as needed for future versions)

        // private static UISchema MigrateTo_1_1_0(UISchema schema)
        // {
        //     // Example: Add new fields with defaults
        //     foreach (var input in schema.Inputs)
        //     {
        //         if (input.StepSize == null)
        //         {
        //             input.StepSize = 1.0; // New field in v1.1.0
        //         }
        //     }
        //     return schema;
        // }

        // private static UISchema MigrateTo_1_2_0(UISchema schema)
        // {
        //     // Example: Rename or restructure fields
        //     if (schema.Layout.Type == "legacy") // Old name
        //     {
        //         schema.Layout.Type = "flat"; // New name in v1.2.0
        //     }
        //     return schema;
        // }
    }

    /// <summary>
    ///     Exception thrown when schema is incompatible with current plugin version
    /// </summary>
    public class IncompatibleSchemaException : Exception
    {
        public IncompatibleSchemaException(string message) : base(message)
        {
        }

        public IncompatibleSchemaException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }
}
