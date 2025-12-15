using System;
using System.Collections.Generic;
using System.Linq;
using Selva.Core.Models;

namespace Selva.Core.Services;

/// <summary>
///   Handles schema migration across versions
/// </summary>
public static class SchemaMigrator
{
  // Current version of the plugin's schema format
  public static readonly Version CURRENT_SCHEMA_VERSION = new Version(1, 0, 0);

  // Migration registry: maps version -> migration function
  private static readonly Dictionary<Version, Func<UISchema, UISchema>> _migrations =
    new Dictionary<Version, Func<UISchema, UISchema>>
    {
      // Example: { new Version(1, 1, 0), MigrateTo_1_1_0 },
    };

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
    if (schema == null)
    {
      throw new ArgumentNullException(nameof(schema));
    }

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
      {
        throw new IncompatibleSchemaException(
          $"This schema requires plugin version {minVersion} or higher. Current version: {currentPluginVersion}");
      }
    }

    // No migration needed if already at current version
    if (schemaVersion >= CURRENT_SCHEMA_VERSION)
    {
      return (schema, changes);
    }

    var migratedSchema = schema;
    var migrationPath = GetMigrationPath(schemaVersion, CURRENT_SCHEMA_VERSION);

    // Apply migrations in order
    foreach (var targetVersion in migrationPath)
    {
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
    }

    migratedSchema.SchemaVersion = CURRENT_SCHEMA_VERSION.ToString();
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
    if (schema == null)
    {
      return (false, new List<string> { "Schema is null" });
    }

    var issues = new List<string>();

    if (string.IsNullOrEmpty(schema.SchemaVersion))
    {
      issues.Add("Legacy schema without version - will be migrated to 1.0.0");
    }
    else
    {
      if (!Version.TryParse(schema.SchemaVersion, out var schemaVersion))
      {
        return (false, new List<string> { $"Invalid schema version format: {schema.SchemaVersion}" });
      }

      if (schemaVersion >= CURRENT_SCHEMA_VERSION)
      {
        issues.Add("Schema is already at current version - no migration needed");
        return (true, issues);
      }

      var migrationPath = GetMigrationPath(schemaVersion, CURRENT_SCHEMA_VERSION);
      if (migrationPath.Any())
      {
        issues.Add($"Migration path: {string.Join(" -> ", migrationPath)}");
        foreach (var version in migrationPath)
        {
          issues.Add(_migrations.ContainsKey(version)
            ? $"✓ Migration to {version} available"
            : $"⚠ No explicit migration for {version} (version update only)");
        }
      }
    }

    if (!string.IsNullOrEmpty(schema.MinPluginVersion))
    {
      if (!Version.TryParse(schema.MinPluginVersion, out var minVersion))
      {
        return (false, new List<string> { $"Invalid minimum plugin version format: {schema.MinPluginVersion}" });
      }

      if (currentPluginVersion < minVersion)
      {
        return (false,
          new List<string>
          {
            $"Incompatible: Schema requires plugin version {minVersion}, current version is {currentPluginVersion}"
          });
      }
    }

    return (true, issues);
  }

  public static bool NeedsMigration(UISchema schema)
  {
    if (schema == null || string.IsNullOrEmpty(schema.SchemaVersion))
    {
      return true;
    }

    try
    {
      return Version.Parse(schema.SchemaVersion) < CURRENT_SCHEMA_VERSION;
    }
    catch
    {
      return true;
    }
  }

  public static (bool IsCompatible, string Message) ValidateCompatibility(UISchema schema, Version currentPluginVersion)
  {
    if (schema == null)
    {
      return (false, "Schema is null");
    }

    if (string.IsNullOrEmpty(schema.SchemaVersion))
    {
      return (true, "Legacy schema detected - will be migrated on load");
    }

    if (!Version.TryParse(schema.SchemaVersion, out var schemaVersion))
    {
      return (false, "Invalid schema version format");
    }

    if (!string.IsNullOrEmpty(schema.MinPluginVersion))
    {
      if (!Version.TryParse(schema.MinPluginVersion, out var minVersion))
      {
        return (false, "Invalid minimum plugin version format");
      }

      if (currentPluginVersion < minVersion)
      {
        return (false, $"Schema requires plugin version {minVersion} or higher. Current: {currentPluginVersion}");
      }
    }

    if (schemaVersion.Major > CURRENT_SCHEMA_VERSION.Major)
    {
      return (false, $"Schema version {schemaVersion} requires a newer version of Selva");
    }

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
