using System;
using System.Collections.Generic;
using Xunit;
using Selva.Core.Models;
using Selva.Core.Services;

namespace Selva.Tests
{
  public class SchemaMigratorTests
  {
    [Fact]
    public void MigrateWithTracking_NullSchema_ThrowsArgumentNullException()
    {
      Assert.Throws<ArgumentNullException>(() =>
          SchemaMigrator.MigrateWithTracking(null, new Version(1, 0, 0)));
    }

    [Fact]
    public void MigrateWithTracking_LegacySchema_SetsVersionTo100()
    {
      var schema = new UISchema
      {
        Id = "legacy-schema",
        SchemaVersion = null // Legacy
      };

      var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(1, 0, 0));

      Assert.Equal("1.0.0", migratedSchema.SchemaVersion);
      Assert.Contains(changes, c => c.Contains("legacy schema detected"));
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
        SchemaVersion = SchemaMigrator.CURRENT_SCHEMA_VERSION.ToString()
      };

      var (migratedSchema, changes) = SchemaMigrator.MigrateWithTracking(schema, new Version(1, 0, 0));

      Assert.Same(schema, migratedSchema);
      Assert.Empty(changes);
    }
  }
}
