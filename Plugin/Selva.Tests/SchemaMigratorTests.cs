using Newtonsoft.Json.Linq;
using Selva.Core.Constants;
using Selva.Core.Models;
using Selva.Core.Services;

namespace Selva.Tests;

public class SchemaMigratorTests
{
	[Fact]
	public void MigrateJson_LegacyFlatLayout_TransformsStructure()
	{
		// Legacy flat layout: layout.type="flat", layout.tabs=[{groups:[...]}]
		var json = JObject.Parse(@"
    {
      'schemaVersion': '1.0.0',
      'layout': {
        'type': 'flat',
        'tabs': [
          {
            'groups': [
              { 'id': 'g1', 'label': 'Group 1', 'items': [] }
            ]
          },
          {
            'groups': [
              { 'id': 'g2', 'label': 'Group 2', 'items': [] }
            ]
          }
        ]
      }
    }");

		var migrated = SchemaMigrator.MigrateJson(json);

		Assert.Equal(SchemaVersion.CURRENT_STRING, migrated["schemaVersion"]?.ToString());

		var layout = migrated["layout"];
		Assert.Null(layout["tabs"]); // Tabs should be removed

		var groups = layout["groups"] as JArray;
		Assert.NotNull(groups);
		Assert.Equal(2, groups.Count);
		Assert.Equal("g1", groups[0]["id"]?.ToString());
		Assert.Equal("g2", groups[1]["id"]?.ToString());
	}

	[Fact]
	public void MigrateWithTracking_NullSchema_ThrowsArgumentNullException()
	{
		Assert.Throws<ArgumentNullException>(() =>
			SchemaMigrator.MigrateWithTracking(null, new Version(1, 0, 0)));
	}

	[Fact]
	public void MigrateWithTracking_LegacySchema_SetsVersionTo100_AndMigratesToCurrent()
	{
		var schema = new UISchema
		{
			Id = "legacy-schema",
			SchemaVersion = null // Legacy
		};

		var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(1, 0, 0));

		// It first sets to 1.0.0, then migrates to 2.0.0
		Assert.Equal(SchemaVersion.CURRENT_STRING, migratedSchema.SchemaVersion);
		Assert.Contains(changes, c => c.Contains("legacy schema detected"));
		Assert.Contains(changes, c => c.Contains($"Applied migration from 1.0.0 to {SchemaVersion.CURRENT}"));
	}

	[Fact]
	public void MigrateWithTracking_IncompatiblePluginVersion_ThrowsException()
	{
		var schema = new UISchema
		{
			Id = "future-schema",
			SchemaVersion = "1.0.0",
			MinPluginVersion = "2.0.0"
		};

		var currentVersion = new Version(1, 0, 0);

		Assert.Throws<IncompatibleSchemaException>(() =>
			SchemaMigrator.MigrateWithTracking(schema, currentVersion));
	}

	[Fact]
	public void MigrateWithTracking_CurrentVersion_NoChanges()
	{
		var schema = new UISchema
		{
			Id = "current-schema",
			SchemaVersion = SchemaVersion.CURRENT_STRING
		};

		var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(1, 0, 0));

		Assert.Same(schema, migratedSchema);
		Assert.Empty(changes);
	}

	[Fact]
	public void MigrateWithTracking_V1toV2_PopulatesNames()
	{
		var schema = new UISchema
		{
			Id = "v1-schema",
			SchemaVersion = "1.0.0",
			Inputs = new List<SchemaInput>
			{
				new() { Id = Guid.NewGuid(), Nickname = "Input1" }
			},
			Outputs = new List<SchemaOutput>
			{
				new() { Id = Guid.NewGuid(), Nickname = "Output1" }
			}
		};

		var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(2, 0, 0));

		Assert.Equal(SchemaVersion.CURRENT_STRING, migratedSchema.SchemaVersion);
		Assert.Equal("Input1", migratedSchema.Inputs[0].Nickname);
		Assert.Equal("Output1", migratedSchema.Outputs[0].Nickname);
		Assert.Contains(changes, c => c.Contains($"Applied migration from 1.0.0 to {SchemaVersion.CURRENT}"));
	}

	[Fact]
	public void MigrateJson_LegacyMissingType_InfersTabbed()
	{
		// Legacy schema without 'type' but with 'tabs'
		var json = JObject.Parse(@"
    {
      'schemaVersion': '1.0.0',
      'layout': {
        'tabs': []
      }
    }");

		var migrated = SchemaMigrator.MigrateJson(json);

		Assert.Equal(SchemaVersion.CURRENT_STRING, migrated["schemaVersion"]?.ToString());
		Assert.Equal("tabbed", migrated["layout"]?["type"]?.ToString());
	}
}
