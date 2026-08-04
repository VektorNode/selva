using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;

namespace Selva.Schema.Services;

/// <summary>
///     Handles schema migration across versions
/// </summary>
public static class SchemaMigrator
{
    [Obsolete("Use SchemaVersion.CURRENT instead", false)]
    public static readonly Version CURRENT_SCHEMA_VERSION = SchemaVersion.CURRENT;

    // Maps version -> migration function
    private static readonly Dictionary<Version, Func<UISchema, UISchema>> _migrations =
        new Dictionary<Version, Func<UISchema, UISchema>>
        {
            { new Version(2, 0, 0), MigrateTo_2_0_0 },
            { new Version(2, 3, 0), MigrateTo_2_3_0 },
            { new Version(2, 4, 0), MigrateTo_2_4_0 },
            { new Version(2, 5, 0), MigrateTo_2_5_0 },
            { new Version(2, 6, 0), MigrateTo_2_6_0 },
            { new Version(2, 7, 0), MigrateTo_2_7_0 },
            { new Version(2, 8, 0), MigrateTo_2_8_0 },
            { new Version(2, 9, 0), MigrateTo_2_9_0 },
            { new Version(2, 10, 0), MigrateTo_2_10_0 },
            { new Version(2, 11, 0), MigrateTo_2_11_0 },
            { new Version(2, 12, 0), MigrateTo_2_12_0 },
            { SchemaVersion.CURRENT, MigrateTo_2_13_0 }
        };

    /// <summary>
    ///     Migrates raw JSON before deserialization, for structural changes the C# model can't handle on its own.
    /// </summary>
    public static JObject MigrateJson(JObject json)
    {
        var versionStr = json["schemaVersion"]?.Value<string>();
        if (string.IsNullOrEmpty(versionStr))
        {
            versionStr = "1.0.0";
            json["schemaVersion"] = versionStr;
        }

        // `schemaVersion` comes from a .gh file that may be hand-edited or corrupt, so
        // a bare Version.Parse can throw Format/Argument/OverflowException. Wrap it in
        // IncompatibleSchemaException (same as ValidateCompatibility) so callers get a
        // clear "Incompatible schema" message instead of a raw parse failure.
        Version version;
        try
        {
            version = Version.Parse(versionStr);
        }
        catch (Exception ex)
        {
            throw new IncompatibleSchemaException(
                $"Invalid schema version format '{versionStr}': {ex.Message}");
        }

        if (version < SchemaVersion.CURRENT)
        {
            var layout = json["layout"] as JObject;
            if (layout != null)
            {
                // v1 layouts have no 'type' discriminator; infer it from structure
                // (v2 needs it for polymorphism).
                var type = layout["type"]?.Value<string>();
                if (string.IsNullOrEmpty(type))
                {
                    if (layout["tabs"] != null)
                    {
                        type = "tabbed";
                    }
                    else if (layout["groups"] != null)
                    {
                        type = "flat";
                    }
                    else
                    {
                        type = "tabbed";
                    }

                    layout["type"] = type;
                }

                // Flat layout used to nest groups under tabs; flatten tabs[].groups[] into groups[].
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
                            {
                                foreach (var group in groups)
                                {
                                    allGroups.Add(group);
                                }
                            }
                        }

                        layout["groups"] = allGroups;
                        layout.Remove("tabs");
                    }
                }
            }

            RenameInputSourceKinds(json);
            UnifyInputSourceKey(json);
            json["schemaVersion"] = SchemaVersion.CURRENT_STRING;
        }

        return json;
    }

    /// <summary>
    ///     Renames legacy `source.kind` values ('external' -> 'client', 'bound' ->
    ///     'server') on every layout item, in both tabbed and flat layouts. Runs
    ///     pre-deserialization: the typed enum no longer accepts the old spellings.
    /// </summary>
    private static void RenameInputSourceKinds(JObject json)
    {
        var renames = new Dictionary<string, string>
        {
            { "external", "client" },
            { "bound", "server" }
        };

        var layout = json["layout"] as JObject;
        if (layout == null) return;

        var groups = new List<JToken>();
        if (layout["groups"] is JArray flatGroups) groups.AddRange(flatGroups);
        if (layout["tabs"] is JArray tabs)
            foreach (var tab in tabs)
                if (tab["groups"] is JArray tabGroups)
                    groups.AddRange(tabGroups);

        foreach (var group in groups)
        {
            if (group["items"] is not JArray items) continue;
            foreach (var item in items)
            {
                var kind = item["source"]?["kind"]?.Value<string>();
                if (kind != null && renames.TryGetValue(kind, out var next))
                    item["source"]!["kind"] = next;
            }
        }
    }

    /// <summary>
    ///     Collapses the old per-side address fields on `source` into one `key`:
    ///     server `path` and the short-lived client `producer` both become `key`;
    ///     the server-only `onMissing` is dropped. Runs pre-deserialization: the
    ///     typed model no longer has the old fields.
    /// </summary>
    private static void UnifyInputSourceKey(JObject json)
    {
        var layout = json["layout"] as JObject;
        if (layout == null) return;

        var groups = new List<JToken>();
        if (layout["groups"] is JArray flatGroups) groups.AddRange(flatGroups);
        if (layout["tabs"] is JArray tabs)
            foreach (var tab in tabs)
                if (tab["groups"] is JArray tabGroups)
                    groups.AddRange(tabGroups);

        foreach (var group in groups)
        {
            if (group["items"] is not JArray items) continue;
            foreach (var item in items)
            {
                if (item["source"] is not JObject source) continue;

                if (source["key"] == null)
                {
                    var legacy = source["path"]?.Value<string>()
                                 ?? source["producer"]?.Value<string>();
                    if (legacy != null) source["key"] = legacy;
                }

                source.Remove("path");
                source.Remove("producer");
                source.Remove("onMissing");
            }
        }
    }

    private static UISchema MigrateTo_2_0_0(UISchema schema)
    {
        schema.SchemaVersion = "2.0.0";

        // Name field removed - nickname is now the only label.

        return schema;
    }

    private static UISchema MigrateTo_2_3_0(UISchema schema)
    {
        schema.SchemaVersion = "2.3.0";

        // inputStructure added; the C# model defaults it to "item" on deserialization,
        // so no explicit migration is needed here.

        return schema;
    }

    private static UISchema MigrateTo_2_4_0(UISchema schema)
    {
        schema.SchemaVersion = "2.4.0";

        // OutputChartLayoutItem added - backward-compatible, no data transform needed.

        return schema;
    }

    private static UISchema MigrateTo_2_5_0(UISchema schema)
    {
        schema.SchemaVersion = "2.5.0";

        // LineBreakLayoutItem added - backward-compatible, no data transform needed.

        return schema;
    }

    private static UISchema MigrateTo_2_6_0(UISchema schema)
    {
        schema.SchemaVersion = "2.6.0";

        // DropdownWidgetConfig.displayAs ('dropdown' | 'checklist') added, defaults to
        // 'dropdown'. VisibilityRule.operator gains 'contains', 'containsAny',
        // 'isEmpty', 'isNotEmpty'.

        return schema;
    }

    private static UISchema MigrateTo_2_7_0(UISchema schema)
    {
        schema.SchemaVersion = "2.7.0";

        // OutputImageLayoutItem (widgetType: "image") and ImageWidgetConfig added, for
        // rendering PNG/JPG/WEBP/GIF/SVG inline.

        return schema;
    }

    private static UISchema MigrateTo_2_8_0(UISchema schema)
    {
        schema.SchemaVersion = "2.8.0";

        // LayoutItemBase.source ({ kind: 'user' | 'external' }) added: signals where an
        // input's value comes from. Absent or kind='user' is normal control behavior;
        // kind='external' means something outside the form fills it (e.g. a producer
        // route writing to sessionStorage).

        return schema;
    }

    private static UISchema MigrateTo_2_9_0(UISchema schema)
    {
        schema.SchemaVersion = "2.9.0";

        // InputSource.kind renamed to describe WHO supplies the value: 'external' ->
        // 'client', 'bound' -> 'server' (string rewrite happens pre-deserialization in
        // MigrateJson/RenameInputSourceKinds). kind='server' gains optional 'path' and
        // 'onMissing': server inputs resolve server-side at solve time via the host's
        // IBindingResolver and aren't rendered by the form. 'onMissing' defaults to
        // 'fail' so an unresolved value errors the solve loudly instead of silently
        // falling back to a default.

        return schema;
    }

    private static UISchema MigrateTo_2_10_0(UISchema schema)
    {
        schema.SchemaVersion = "2.10.0";

        // The separate 'path' (server) and short-lived 'producer' (client) fields
        // collapse into one opaque 'key', interpreted by the host per 'kind' (client:
        // which producer app; server: what to fetch). 'onMissing' is dropped. The fold
        // runs pre-deserialization in MigrateJson/UnifyInputSourceKey, so a saved
        // 2.9.0 'path'/'producer' carries over into 'key'.

        return schema;
    }

    private static UISchema MigrateTo_2_11_0(UISchema schema)
    {
        schema.SchemaVersion = "2.11.0";

        // 'dynamicValueList' added to ParamType, plus
        // InputDynamicValueListLayoutItem / OutputDynamicValueListLayoutItem and their
        // configs. A dynamic value list input's options populate at runtime from a
        // dynamic value list output that targets it (by targetInputId).

        return schema;
    }

    private static UISchema MigrateTo_2_12_0(UISchema schema)
    {
        schema.SchemaVersion = SchemaVersion.CURRENT_STRING;

        // 'schemaVersion' is now required on UISchema - in practice backward-compatible,
        // since the C# model has always emitted it and this migrator stamps it onto
        // every legacy schema. Made required so the web side can treat a stored
        // schema's version as authoritative for its migrate-on-read staleness check.

        return schema;
    }

    private static UISchema MigrateTo_2_13_0(UISchema schema)
    {
        schema.SchemaVersion = SchemaVersion.CURRENT_STRING;

        // GrasshopperParamType -> ParamType, GrasshopperInputStructure -> InputStructure
        // renamed (schema definition names only; no persisted field values changed,
        // paramType/inputStructure still serialize as their lowercase enum strings).

        return schema;
    }

    public static UISchema MigrateToCurrentVersion(UISchema schema, Version currentPluginVersion)
    {
        var (migratedSchema, _) = MigrateWithTracking(schema, currentPluginVersion);
        return migratedSchema;
    }

    public static (UISchema Schema, List<string> Changes) MigrateWithTracking(UISchema schema,
        Version currentPluginVersion)
    {
        if (schema == null)
        {
            throw new ArgumentNullException(nameof(schema));
        }

        var changes = new List<string>();

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

            if (currentPluginVersion < minVersion)
            {
                throw new IncompatibleSchemaException(
                    $"This schema requires plugin version {minVersion} or higher. Current version: {currentPluginVersion}");
            }
        }

        if (schemaVersion >= SchemaVersion.CURRENT)
        {
            return (schema, changes);
        }

        var migratedSchema = schema;
        var migrationPath = GetMigrationPath(schemaVersion, SchemaVersion.CURRENT);

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
                return (false,
                    new List<string> { $"Invalid minimum plugin version format: {schema.MinPluginVersion}" });
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
            return Version.Parse(schema.SchemaVersion) < SchemaVersion.CURRENT;
        }
        catch
        {
            return true;
        }
    }

    public static (bool IsCompatible, string Message) ValidateCompatibility(UISchema schema,
        Version currentPluginVersion)
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
                return (false,
                    $"Schema requires plugin version {minVersion} or higher. Current: {currentPluginVersion}");
            }
        }

        if (schemaVersion.Major > SchemaVersion.CURRENT.Major)
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
