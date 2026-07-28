using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;
using Selva.Schema.Services;

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

    [Fact]
    public void MigrateJson_RenamesInputSourceKinds_FlatLayout()
    {
        // 2.9.0 renamed source.kind values: external -> client, bound -> server.
        var json = JObject.Parse("""
                                 {
                                 	"schemaVersion": "2.8.0",
                                 	"layout": {
                                 		"type": "flat",
                                 		"groups": [
                                 			{
                                 				"id": "g1", "label": "G1", "items": [
                                 					{ "type": "input", "paramId": "a", "source": { "kind": "external" } },
                                 					{ "type": "input", "paramId": "b", "source": { "kind": "bound", "path": "segment.outline" } },
                                 					{ "type": "input", "paramId": "c", "source": { "kind": "user" } },
                                 					{ "type": "input", "paramId": "d" }
                                 				]
                                 			}
                                 		]
                                 	}
                                 }
                                 """);

        var migrated = SchemaMigrator.MigrateJson(json);
        var items = migrated["layout"]?["groups"]?[0]?["items"] as JArray;

        Assert.NotNull(items);
        Assert.Equal("client", items[0]["source"]?["kind"]?.ToString());
        Assert.Equal("server", items[1]["source"]?["kind"]?.ToString());
        // 2.10.0 unified the address: 'path' folds into 'key' and 'path' is dropped.
        Assert.Equal("segment.outline", items[1]["source"]?["key"]?.ToString());
        Assert.Null(items[1]["source"]?["path"]);
        // 'user' and source-less items are untouched.
        Assert.Equal("user", items[2]["source"]?["kind"]?.ToString());
        Assert.Null(items[3]["source"]);
    }

    [Fact]
    public void MigrateJson_RenamesInputSourceKinds_TabbedLayout()
    {
        var json = JObject.Parse("""
                                 {
                                 	"schemaVersion": "2.8.0",
                                 	"layout": {
                                 		"type": "tabbed",
                                 		"tabs": [
                                 			{ "groups": [ { "id": "g1", "label": "G1", "items": [
                                 				{ "type": "input", "paramId": "a", "source": { "kind": "external" } }
                                 			] } ] }
                                 		]
                                 	}
                                 }
                                 """);

        var migrated = SchemaMigrator.MigrateJson(json);
        var items = migrated["layout"]?["tabs"]?[0]?["groups"]?[0]?["items"] as JArray;

        Assert.NotNull(items);
        Assert.Equal("client", items[0]["source"]?["kind"]?.ToString());
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

    // -------------------------------------------------------------------------
    // MigrateJson — hostile input (audit Q5.8)
    //
    // `schemaVersion` comes off disk, from a .gh file that may be corrupt or
    // hand-edited, so every value below is reachable without a malicious actor.
    // The contract: a bad version is an IncompatibleSchemaException (which
    // SchemaArchiveSerializer already renders as "Incompatible schema: …"),
    // never a raw parse exception leaking out of the migrator.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("abc")]            // not a version at all
    [InlineData("2")]              // too few components for Version.Parse
    [InlineData("2.x.0")]          // non-numeric component
    [InlineData("-1.0.0")]         // negative component
    [InlineData("2.0.0.0.0")]      // too many components
    [InlineData("99999999999.0.0")] // overflows Int32
    [InlineData("  ")]             // whitespace (not caught by IsNullOrEmpty)
    [InlineData("v2.0.0")]         // common hand-edit slip
    public void MigrateJson_MalformedSchemaVersion_ThrowsIncompatibleSchema(string versionStr)
    {
        var json = new JObject
        {
            ["schemaVersion"] = versionStr,
            ["layout"] = new JObject { ["type"] = "flat" }
        };

        var ex = Assert.Throws<IncompatibleSchemaException>(() => SchemaMigrator.MigrateJson(json));
        // The message must name the offending value — an operator staring at a
        // failed file load needs to know WHICH version string was rejected.
        Assert.Contains(versionStr.Trim().Length > 0 ? versionStr : "", ex.Message);
    }

    [Fact]
    public void MigrateJson_MissingSchemaVersion_TreatedAsLegacy_1_0_0()
    {
        // The absent-version case is legitimate (pre-versioning schemas) and must
        // keep working — it is the reason the malformed cases can't simply be
        // lumped in with "no version".
        var json = new JObject { ["layout"] = new JObject { ["type"] = "flat" } };

        var migrated = SchemaMigrator.MigrateJson(json);

        Assert.NotNull(migrated);
        Assert.Equal(SchemaVersion.CURRENT_STRING, migrated["schemaVersion"]?.Value<string>());
    }

    [Fact]
    public void MigrateJson_EmptySchemaVersion_TreatedAsLegacy_1_0_0()
    {
        var json = new JObject
        {
            ["schemaVersion"] = "",
            ["layout"] = new JObject { ["type"] = "flat" }
        };

        var migrated = SchemaMigrator.MigrateJson(json);

        Assert.Equal(SchemaVersion.CURRENT_STRING, migrated["schemaVersion"]?.Value<string>());
    }

    [Fact]
    public void MigrateJson_FutureSchemaVersion_IsLeftAlone()
    {
        // A schema newer than this plugin isn't malformed — MigrateJson has no
        // migration to apply, so it must pass through rather than throw. (The
        // version-compatibility verdict belongs to ValidateCompatibility.)
        var json = new JObject
        {
            ["schemaVersion"] = "99.0.0",
            ["layout"] = new JObject { ["type"] = "flat" }
        };

        var migrated = SchemaMigrator.MigrateJson(json);

        Assert.Equal("99.0.0", migrated["schemaVersion"]?.Value<string>());
    }
}
