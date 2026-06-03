using System;
using System.Collections.Generic;
using System.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.Tests;

/// <summary>
///     The schema invariant that prevents the class of bug where a dynamicValueList output lives only
///     in the layout and is silently dropped by consumers scanning schema.Outputs. After
///     canonicalization, every layout DynVL is mirrored into Outputs — so collector and UI read one
///     place. These pin the invariant; the plugin enforces it in SchemaSynchronizer's validate funnel.
/// </summary>
public class SchemaOutputCanonicalizerTests
{
    private static readonly Guid Bake = Guid.Parse("bc55cef0-0000-0000-0000-000000000001");
    private static readonly Guid Target = Guid.Parse("11112222-0000-0000-0000-000000000002");

    private static UISchema SchemaWithLayoutDvl(Guid bakeId, Guid targetId, string displayName = "DNY")
    {
        return new UISchema
        {
            Inputs = new List<SchemaInput>(),
            Outputs = new List<SchemaOutput>(),
            Layout = new TabbedLayoutConfig
            {
                Tabs = new List<TabConfig>
                {
                    new()
                    {
                        Id = "t1",
                        Groups = new List<GroupConfig>
                        {
                            new()
                            {
                                Id = "g1",
                                Items = new List<LayoutItemBase>
                                {
                                    new OutputDynamicValueListLayoutItem
                                    {
                                        Id = "li1",
                                        ParamId = bakeId,
                                        DisplayName = displayName,
                                        Config = new DynamicValueListOutputConfig { TargetInputId = targetId }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    [Fact]
    public void LayoutOnlyDvl_IsMirroredIntoOutputs()
    {
        var schema = SchemaWithLayoutDvl(Bake, Target);

        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);

        var output = Assert.Single(schema.Outputs);
        Assert.Equal(Bake, output.Id);
        Assert.Equal("dynamicValueList", output.Type);
        Assert.Equal(Target, output.TargetInputId);
        Assert.Equal("DNY", output.Nickname);
    }

    [Fact]
    public void Idempotent_SecondRunAddsNothing()
    {
        var schema = SchemaWithLayoutDvl(Bake, Target);

        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);
        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);

        Assert.Single(schema.Outputs);
    }

    [Fact]
    public void ExistingOutput_IsNotDuplicatedOrOverwritten()
    {
        var schema = SchemaWithLayoutDvl(Bake, Target);
        schema.Outputs.Add(new SchemaOutput
        {
            Id = Bake,
            Type = "dynamicValueList",
            TargetInputId = Target,
            Nickname = "already here"
        });

        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);

        var output = Assert.Single(schema.Outputs);
        Assert.Equal("already here", output.Nickname);
    }

    [Fact]
    public void NoDvlInLayout_LeavesOutputsUntouched()
    {
        var schema = new UISchema
        {
            Inputs = new List<SchemaInput>(),
            Outputs = new List<SchemaOutput>(),
            Layout = new TabbedLayoutConfig { Tabs = new List<TabConfig>() }
        };

        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);

        Assert.Empty(schema.Outputs);
    }

    [Fact]
    public void NullSchemaOrLayout_DoesNotThrow()
    {
        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(null);
        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(
            new UISchema { Layout = null });
    }

    [Fact]
    public void NullOutputsList_IsInitializedThenPopulated()
    {
        var schema = SchemaWithLayoutDvl(Bake, Target);
        schema.Outputs = null;

        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);

        Assert.NotNull(schema.Outputs);
        Assert.Single(schema.Outputs);
    }

    [Fact]
    public void GetAllLayoutItems_FlattensFlatAndTabbed()
    {
        var schema = SchemaWithLayoutDvl(Bake, Target);

        var items = SchemaOutputCanonicalizer.GetAllLayoutItems(schema.Layout).ToList();

        Assert.Single(items);
        Assert.IsType<OutputDynamicValueListLayoutItem>(items[0]);
    }

    // The qualifying bake-output set is the single source of truth that the post-solve add/remove
    // sync, the scope filter, and ClassifyBakeOutputType must all honour. dynamicValueList being a
    // member is exactly what stops the post-solve pass from stripping it every solve. Pinning the set
    // makes adding/removing a bake output type a visible, intentional diff — not a silent half-wire.
    [Fact]
    public void BakeOutputTypes_PinsTheSupportedSet()
    {
        Assert.Equal(
            new[] { "file", "chart", "dynamicValueList" },
            SchemaOutputCanonicalizer.BakeOutputTypes);
    }

    [Fact]
    public void BakeOutputTypes_IncludesDynamicValueList()
    {
        // Regression guard: the canonicalizer writes dynamicValueList outputs; the post-solve sync's
        // qualifying set MUST contain it or they get removed every solve.
        Assert.Contains("dynamicValueList", SchemaOutputCanonicalizer.BakeOutputTypes);
    }
}
