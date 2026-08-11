using System;
using System.Collections.Generic;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.Tests;

/// <summary>
///     Tests for SchemaSaveGuard — the decision that protects a stored schema from being replaced
///     by an incoming save.
///
///     These cover a data-loss path reproduced against a live Grasshopper session: a Context Bake
///     only carries the schema while a solve's volatile data is alive, so after a cleared or
///     expired solve the editor is handed a fabricated empty schema while the component still
///     holds the real one. Saving that empty schema used to overwrite the real one silently
///     whenever the base hash was absent.
/// </summary>
public class SchemaSaveGuardTests
{
    // UISchema.Created/LastModified default to DateTime.UtcNow; pin them so hashes are comparable.
    private static readonly DateTime FixedTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static UISchema Populated(string name = "Real Fixture")
    {
        return new UISchema
        {
            Id = "aaaaaaaa-1111-2222-3333-444444444444",
            Name = name,
            Created = FixedTime,
            LastModified = FixedTime,
            Inputs = { new SchemaInput { Id = Guid.NewGuid(), Nickname = "Width" } }
        };
    }

    /// <summary>Mirrors BridgeOrchestrator.CreateDefaultSchema — params empty, layout with no tabs.</summary>
    private static UISchema FabricatedDefault()
    {
        return new UISchema
        {
            Id = Guid.NewGuid().ToString(),
            Name = "New Schema",
            Created = FixedTime,
            LastModified = FixedTime,
            Layout = new TabbedLayoutConfig { Tabs = [] }
        };
    }

    // -------------------------------------------------------------------------
    // Empty-overwrite protection
    // -------------------------------------------------------------------------

    [Fact]
    public void Evaluate_EmptySchemaOverNonEmpty_IsRejected()
    {
        var current = Populated();

        var verdict = SchemaSaveGuard.Evaluate(current, FabricatedDefault(), SchemaHash.Compute(current));

        // Rejected even though the base hash matches: content loss outranks a clean handshake.
        Assert.Equal(SchemaSaveVerdict.RejectEmptyOverwrite, verdict);
    }

    [Fact]
    public void Evaluate_EmptySchemaWithNoBaseHash_IsRejected()
    {
        // The exact live repro: cleared solve -> fabricated default -> save with no base hash.
        var verdict = SchemaSaveGuard.Evaluate(Populated(), FabricatedDefault(), null);

        Assert.Equal(SchemaSaveVerdict.RejectEmptyOverwrite, verdict);
    }

    [Fact]
    public void Evaluate_EmptySchemaOverEmpty_IsAccepted()
    {
        var current = FabricatedDefault();

        var verdict = SchemaSaveGuard.Evaluate(current, FabricatedDefault(), SchemaHash.Compute(current));

        // Nothing to lose — an empty definition may stay empty.
        Assert.Equal(SchemaSaveVerdict.Accept, verdict);
    }

    [Fact]
    public void Evaluate_DeliberateClearOfAllParams_IsStillRejected()
    {
        // A user really can want to empty a schema, but the guard cannot tell that apart from the
        // fabricated-default path, so it refuses and the UI must re-solve to get a live base.
        var current = Populated();
        var cleared = Populated();
        cleared.Inputs.Clear();

        Assert.Equal(SchemaSaveVerdict.RejectEmptyOverwrite,
            SchemaSaveGuard.Evaluate(current, cleared, SchemaHash.Compute(current)));
    }

    // -------------------------------------------------------------------------
    // Base-hash handling
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Evaluate_MissingBaseHash_IsRejectedNotAccepted(string? baseHash)
    {
        // Regression: this used to skip the staleness check entirely and overwrite. The frontend
        // nulls its canonical hash after a metadata update, so it is reachable in normal use.
        var incoming = Populated("Edited");

        var verdict = SchemaSaveGuard.Evaluate(Populated(), incoming, baseHash);

        Assert.Equal(SchemaSaveVerdict.RejectMissingBase, verdict);
    }

    [Fact]
    public void Evaluate_StaleBaseHash_IsRejected()
    {
        var verdict = SchemaSaveGuard.Evaluate(Populated(), Populated("Edited"), new string('0', 64));

        Assert.Equal(SchemaSaveVerdict.RejectStaleBase, verdict);
    }

    [Fact]
    public void Evaluate_MatchingBaseHash_IsAccepted()
    {
        var current = Populated();
        var incoming = Populated("Edited");
        incoming.Inputs.Add(new SchemaInput { Id = Guid.NewGuid(), Nickname = "Height" });

        var verdict = SchemaSaveGuard.Evaluate(current, incoming, SchemaHash.Compute(current));

        Assert.Equal(SchemaSaveVerdict.Accept, verdict);
    }

    [Fact]
    public void Evaluate_NoCurrentSchema_AcceptsAnything()
    {
        // First save on a fresh component: there is nothing to protect, and no base hash exists.
        Assert.Equal(SchemaSaveVerdict.Accept, SchemaSaveGuard.Evaluate(null, FabricatedDefault(), null));
        Assert.Equal(SchemaSaveVerdict.Accept, SchemaSaveGuard.Evaluate(null, Populated(), null));
    }

    // -------------------------------------------------------------------------
    // IsEmpty
    // -------------------------------------------------------------------------

    [Fact]
    public void IsEmpty_NullSchema_IsEmpty()
    {
        Assert.True(SchemaSaveGuard.IsEmpty(null));
    }

    [Fact]
    public void IsEmpty_FabricatedDefault_IsEmpty()
    {
        Assert.True(SchemaSaveGuard.IsEmpty(FabricatedDefault()));
    }

    [Fact]
    public void IsEmpty_OutputsOnly_IsNotEmpty()
    {
        var schema = FabricatedDefault();
        schema.Outputs.Add(new SchemaOutput { Id = Guid.NewGuid(), Nickname = "Result", Type = "text" });

        Assert.False(SchemaSaveGuard.IsEmpty(schema));
    }

    [Fact]
    public void IsEmpty_LayoutItemsWithoutParams_IsNotEmpty()
    {
        // Layout content alone is still authored work worth protecting.
        var schema = FabricatedDefault();
        schema.Layout = new TabbedLayoutConfig
        {
            Tabs =
            [
                new TabConfig
                {
                    Id = "tab-1", Label = "Main",
                    Groups =
                    [
                        new GroupConfig
                        {
                            Id = "grp-1", Label = "Dims",
                            Items = [new InputNumberLayoutItem { Id = "i1", ParamId = Guid.NewGuid() }]
                        }
                    ]
                }
            ]
        };

        Assert.False(SchemaSaveGuard.IsEmpty(schema));
    }

    [Fact]
    public void IsEmpty_TabsWithEmptyGroups_IsEmpty()
    {
        var schema = FabricatedDefault();
        schema.Layout = new TabbedLayoutConfig
        {
            Tabs = [new TabConfig { Id = "tab-1", Label = "Main", Groups = [new GroupConfig { Id = "g", Label = "G" }] }]
        };

        Assert.True(SchemaSaveGuard.IsEmpty(schema));
    }

    [Fact]
    public void IsEmpty_FlatLayoutWithItems_IsNotEmpty()
    {
        var schema = FabricatedDefault();
        schema.Layout = new FlatLayoutConfig
        {
            Groups =
            [
                new GroupConfig
                {
                    Id = "grp-1", Label = "Dims",
                    Items = [new InputNumberLayoutItem { Id = "i1", ParamId = Guid.NewGuid() }]
                }
            ]
        };

        Assert.False(SchemaSaveGuard.IsEmpty(schema));
    }
}
