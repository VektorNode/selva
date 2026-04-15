using Newtonsoft.Json.Linq;
using Selva.Core.Constants;
using Selva.Core.Models;
using Selva.Core.Services;

namespace Selva.Tests;

/// <summary>
///     Unit tests for specific SchemaMigrator behaviours that are NOT covered by SchemaFixtureTests.
///     Round-trip / golden-fixture coverage lives in SchemaFixtureTests instead.
/// </summary>
public class SchemaMigratorTests
{
    // -------------------------------------------------------------------------
    // MigrateJson — structural (JObject-level) migrations
    // -------------------------------------------------------------------------

    [Fact]
    public void MigrateJson_LegacyFlatLayout_CollapsesTabsIntoGroups()
    {
        // v1 flat layout stored groups inside a tabs array; migration must flatten it
        var json = JObject.Parse("""
                                 {
                                 	"schemaVersion": "1.0.0",
                                 	"layout": {
                                 		"type": "flat",
                                 		"tabs": [
                                 			{ "groups": [ { "id": "g1", "label": "Group 1", "items": [] } ] },
                                 			{ "groups": [ { "id": "g2", "label": "Group 2", "items": [] } ] }
                                 		]
                                 	}
                                 }
                                 """);

        var migrated = SchemaMigrator.MigrateJson(json);

        Assert.Equal(SchemaVersion.CURRENT_STRING, migrated["schemaVersion"]?.ToString());
        Assert.Null(migrated["layout"]?["tabs"]);
        var groups = migrated["layout"]?["groups"] as JArray;
        Assert.NotNull(groups);
        Assert.Equal(2, groups.Count);
        Assert.Equal("g1", groups[0]["id"]?.ToString());
        Assert.Equal("g2", groups[1]["id"]?.ToString());
    }

    [Fact]
    public void MigrateJson_MissingLayoutType_InfersTabbedFromTabs()
    {
        var json = JObject.Parse("""
                                 {
                                 	"schemaVersion": "1.0.0",
                                 	"layout": { "tabs": [] }
                                 }
                                 """);

        var migrated = SchemaMigrator.MigrateJson(json);

        Assert.Equal("tabbed", migrated["layout"]?["type"]?.ToString());
    }

    [Fact]
    public void MigrateJson_MissingLayoutType_InfersFlatFromGroups()
    {
        var json = JObject.Parse("""
                                 {
                                 	"schemaVersion": "1.0.0",
                                 	"layout": { "groups": [] }
                                 }
                                 """);

        var migrated = SchemaMigrator.MigrateJson(json);

        Assert.Equal("flat", migrated["layout"]?["type"]?.ToString());
    }

    // -------------------------------------------------------------------------
    // MigrateWithTracking — object-level migrations and version handling
    // -------------------------------------------------------------------------

    [Fact]
    public void MigrateWithTracking_NullSchema_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() =>
            SchemaMigrator.MigrateWithTracking(null, new Version(1, 0, 0)));
    }

    [Fact]
    public void MigrateWithTracking_CurrentVersion_ReturnsUnchanged()
    {
        var schema = new UISchema { Id = "s", SchemaVersion = SchemaVersion.CURRENT_STRING };

        var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(1, 0, 0));

        Assert.Same(schema, migratedSchema);
        Assert.Empty(changes);
    }

    [Fact]
    public void MigrateWithTracking_LegacySchema_SetsVersion100ThenMigratesToCurrent()
    {
        var schema = new UISchema { Id = "s", SchemaVersion = null };

        var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(99, 0, 0));

        Assert.Equal(SchemaVersion.CURRENT_STRING, migratedSchema.SchemaVersion);
        Assert.Contains(changes, c => c.Contains("legacy schema detected"));
        Assert.Contains(changes, c => c.Contains("Applied migration from 1.0.0 to 2.0.0"));
    }

    [Fact]
    public void MigrateWithTracking_IncompatibleMinPluginVersion_Throws()
    {
        var schema = new UISchema { Id = "s", SchemaVersion = "1.0.0", MinPluginVersion = "5.0.0" };

        Assert.Throws<IncompatibleSchemaException>(() =>
            SchemaMigrator.MigrateWithTracking(schema, new Version(1, 0, 0)));
    }

    [Fact]
    public void MigrateWithTracking_V100_RecordsEachMigrationStep()
    {
        var schema = new UISchema
        {
            Id = "s",
            SchemaVersion = "1.0.0",
            Inputs = new List<SchemaInput> { new SchemaInput { Id = Guid.NewGuid(), Nickname = "W" } },
            Outputs = new List<SchemaOutput> { new SchemaOutput { Id = Guid.NewGuid(), Nickname = "R" } }
        };

        var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(99, 0, 0));

        Assert.Equal(SchemaVersion.CURRENT_STRING, migratedSchema.SchemaVersion);
        Assert.Contains(changes, c => c.Contains("Applied migration from 1.0.0 to 2.0.0"));
    }
}
