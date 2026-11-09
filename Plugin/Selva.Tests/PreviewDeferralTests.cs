using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.SolveRuntime.Services;
using Selva.Schema.Models;
using Xunit;
using Kind = Selva.GH.Features.SolveRuntime.Services.PreviewDeferral.NodeKind;

namespace Selva.Tests;

/// <summary>One case per wiring shape that decides whether a file output is deferred, plus the schema side.</summary>
public class PreviewDeferralTests
{
    private static readonly Guid Export = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
    private static readonly Guid Svg = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000002");
    private static readonly Guid DownloadBake = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000001");
    private static readonly Guid ImageBake = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000002");
    private static readonly Guid UnlistedBake = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000003");
    private static readonly Guid Relay = Guid.Parse("cccccccc-0000-4000-8000-000000000001");
    private static readonly Guid Merge = Guid.Parse("dddddddd-0000-4000-8000-000000000001");
    private static readonly Guid SizeReadout = Guid.Parse("dddddddd-0000-4000-8000-000000000002");
    private static readonly Guid Zip = Guid.Parse("dddddddd-0000-4000-8000-000000000003");

    private static PreviewDeferral.Graph Graph() =>
        new PreviewDeferral.Graph(new[] { DownloadBake })
            .Add(Export, Kind.FileComponent, "Export")
            .Add(Svg, Kind.FileComponent, "SVG")
            .Add(DownloadBake, Kind.ContextBake, "Files")
            .Add(ImageBake, Kind.ContextBake, "Drawing")
            .Add(UnlistedBake, Kind.ContextBake, "Spare")
            .Add(Relay, Kind.Relay, "Relay")
            .Add(Merge, Kind.Other, "Merge")
            .Add(SizeReadout, Kind.Other, "File Size")
            .Add(Zip, Kind.FileComponent, "Zip");

    [Fact]
    public void FeedingOnlyADownload_Defers()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake));

        Assert.True(plan.Defers(Export));
        Assert.Equal(new[] { DownloadBake }, plan.Bakes);
        Assert.Empty(plan.Reasons);
    }

    [Fact]
    public void ThroughARelay_Defers()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, Relay).Wire(Relay, DownloadBake));

        Assert.True(plan.Defers(Export));
        Assert.Equal(new[] { DownloadBake }, plan.Bakes);
    }

    [Fact]
    public void AlsoShownInAnImageWidget_IsMadeEverySolve()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Svg, DownloadBake).Wire(Svg, ImageBake));

        Assert.False(plan.Defers(Svg));
        Assert.Empty(plan.Bakes);
        Assert.Equal("also feeds Drawing (not a Download)", plan.Reasons[Svg]);
    }

    [Fact]
    public void AlsoFeedingASizeReadout_IsMadeEverySolve()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake).Wire(Export, SizeReadout));

        Assert.False(plan.Defers(Export));
        Assert.Equal("also feeds File Size", plan.Reasons[Export]);
    }

    [Fact]
    public void BehindAMerge_IsMadeEverySolve_AndSaysWhy()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, Merge).Wire(Merge, DownloadBake));

        Assert.False(plan.Defers(Export));
        Assert.Empty(plan.Bakes);
        Assert.Equal("reaches its Download through Merge", plan.Reasons[Export]);
    }

    [Fact]
    public void FeedingAnotherFileComponent_IsMadeEverySolve()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake).Wire(Export, Zip));

        Assert.False(plan.Defers(Export));
        Assert.Equal("also feeds Zip", plan.Reasons[Export]);
    }

    [Fact]
    public void NoRecipient_IsMadeEverySolve()
    {
        var plan = PreviewDeferral.Decide(Graph());

        Assert.False(plan.Defers(Export));
        Assert.Empty(plan.Reasons);
    }

    [Fact]
    public void ARelayLeadingNowhere_IsMadeEverySolve()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake).Wire(Export, Relay));

        Assert.False(plan.Defers(Export));
        Assert.Equal("also feeds Relay", plan.Reasons[Export]);
    }

    [Fact]
    public void ABakeNotInTheLayout_IsMadeEverySolve()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, UnlistedBake));

        Assert.False(plan.Defers(Export));
        Assert.Empty(plan.Reasons);
    }

    [Fact]
    public void TwoFileComponentsIntoOneDownload_BothDefer_AndTheBakeIsListedOnce()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake).Wire(Svg, DownloadBake));

        Assert.True(plan.Defers(Export));
        Assert.True(plan.Defers(Svg));
        Assert.Equal(new[] { DownloadBake }, plan.Bakes);
    }

    [Fact]
    public void AnUnknownRecipient_Blocks()
    {
        var stranger = Guid.Parse("eeeeeeee-0000-4000-8000-000000000001");
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake).Wire(Export, stranger));

        Assert.False(plan.Defers(Export));
    }

    // ============================================================================
    // Schema side
    // ============================================================================

    private static UISchema Schema(bool? previewSolves, params LayoutItemBase[] items) =>
        new UISchema
        {
            PreviewSolves = previewSolves,
            Layout = new TabbedLayoutConfig
            {
                Tabs = new List<TabConfig>
                {
                    new() { Id = "t1", Groups = new List<GroupConfig> { new() { Id = "g1", Items = items.ToList() } } }
                }
            }
        };

    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    public void ASchemaThatDoesNotOptIn_DefersNothing(bool? previewSolves)
    {
        var schema = Schema(previewSolves, new OutputFileLayoutItem { Id = "a", ParamId = DownloadBake });

        Assert.Null(PreviewDeferral.DownloadBakes(schema));
        Assert.Null(PreviewDeferral.DownloadBakes(null));
    }

    [Fact]
    public void OnlyBakesShownSolelyAsDownloadsCount()
    {
        var schema = Schema(true,
            new OutputFileLayoutItem { Id = "a", ParamId = DownloadBake },
            new OutputFileLayoutItem { Id = "b", ParamId = ImageBake },
            new OutputImageLayoutItem { Id = "c", ParamId = ImageBake },
            new OutputTextLayoutItem { Id = "d", ParamId = UnlistedBake });

        Assert.Equal(new[] { DownloadBake }, PreviewDeferral.DownloadBakes(schema));
    }

    [Fact]
    public void DeferredIds_AreWrittenAsTheSchemaWritesOutputIds()
    {
        var plan = PreviewDeferral.Decide(Graph().Wire(Export, DownloadBake));
        var written = JObject.FromObject(new SchemaOutput { Id = DownloadBake })["id"]!.Value<string>();

        Assert.Equal(new[] { written }, plan.DeferredOutputIds());
    }

    [Fact]
    public void Outcome_CarriesDeferredIds_OnlyWhenThereAreAny()
    {
        Assert.Null(new SolveDiagnostics().ToOutcome().Deferred);
        Assert.Null(new SolveDiagnostics { Deferred = new List<string>() }.ToOutcome().Deferred);
        Assert.Equal(new[] { "x" }, new SolveDiagnostics { Deferred = new List<string> { "x" } }.ToOutcome().Deferred);
    }
}
