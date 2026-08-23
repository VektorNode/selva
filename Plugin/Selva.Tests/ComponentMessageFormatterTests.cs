using System;
using Selva.GH.Features.UIBuilder.Services;
using Selva.Schema.Models;

namespace Selva.Tests;

/// <summary>Tests for the UI Builder component's Info/canvas status text.</summary>
public class ComponentMessageFormatterTests
{
    private const string Session = "sess-123";

    private static UISchema SchemaWith(int inputs, int outputs)
    {
        var schema = new UISchema { Id = "s" };
        for (var i = 0; i < inputs; i++)
        {
            schema.Inputs.Add(new SchemaInput { Id = Guid.NewGuid(), Nickname = $"In{i}" });
        }

        for (var i = 0; i < outputs; i++)
        {
            schema.Outputs.Add(new SchemaOutput { Id = Guid.NewGuid(), Nickname = $"Out{i}" });
        }

        return schema;
    }

    // -------------------------------------------------------------------------
    // CreateInfoMessage — status word
    // -------------------------------------------------------------------------

    [Fact]
    public void InfoMessage_Disabled_ShowsDisabledStatus()
    {
        var msg = ComponentMessageFormatter.CreateInfoMessage(Session, false, null, false);

        Assert.Contains("Status: Disabled", msg);
        Assert.Contains(Session, msg);
    }

    [Fact]
    public void InfoMessage_EnabledConnected_ShowsActiveWebSocket()
    {
        var msg = ComponentMessageFormatter.CreateInfoMessage(Session, true, SchemaWith(2, 1), true);

        Assert.Contains("Status: Active (WebSocket)", msg);
    }

    [Fact]
    public void InfoMessage_Headless_ShowsHeadlessStatusAndNote()
    {
        var msg = ComponentMessageFormatter.CreateInfoMessage(Session, true, SchemaWith(1, 1), false, isHeadless: true);

        Assert.Contains("Status: Headless Mode", msg);
        Assert.Contains("no WebSocket", msg);
    }

    // -------------------------------------------------------------------------
    // CreateInfoMessage — schema content branches
    // -------------------------------------------------------------------------

    [Fact]
    public void InfoMessage_EnabledWithIo_ShowsInputOutputCounts()
    {
        var msg = ComponentMessageFormatter.CreateInfoMessage(Session, true, SchemaWith(3, 2), true);

        Assert.Contains("Schema: 3 inputs, 2 outputs", msg);
    }

    [Fact]
    public void InfoMessage_EnabledEmptySchema_ShowsWaiting()
    {
        var msg = ComponentMessageFormatter.CreateInfoMessage(Session, true, SchemaWith(0, 0), true);

        Assert.Contains("Waiting for schema...", msg);
    }

    [Fact]
    public void InfoMessage_DisabledWithSchema_ShowsSavedCountsAndHint()
    {
        var msg = ComponentMessageFormatter.CreateInfoMessage(Session, false, SchemaWith(2, 1), false);

        Assert.Contains("Schema: 2 inputs, 1 outputs (saved)", msg);
        Assert.Contains("Set Enable to true to start", msg);
    }

    [Fact]
    public void InfoMessage_NoSchema_ShowsNoSchemaYet()
    {
        var enabled = ComponentMessageFormatter.CreateInfoMessage(Session, true, null, false);
        var disabled = ComponentMessageFormatter.CreateInfoMessage(Session, false, null, false);

        Assert.Contains("No schema yet", enabled);
        Assert.Contains("No schema yet", disabled);
        Assert.Contains("Set Enable to true to start", disabled);
    }

    // -------------------------------------------------------------------------
    // CreateDisplayMessage — canvas label
    // -------------------------------------------------------------------------

    [Fact]
    public void DisplayMessage_DisabledWithSchema_ShowsOffline()
    {
        var msg = ComponentMessageFormatter.CreateDisplayMessage(false, true, SchemaWith(1, 0), Session);

        Assert.Equal("Offline", msg);
    }

    [Fact]
    public void DisplayMessage_DisabledNoSchema_ShowsOfflineNoSchema()
    {
        var msg = ComponentMessageFormatter.CreateDisplayMessage(false, false, null, Session);

        Assert.Equal("Offline • No Schema", msg);
    }

    [Fact]
    public void DisplayMessage_EnabledNotConnected_ShowsHeadless()
    {
        var msg = ComponentMessageFormatter.CreateDisplayMessage(true, false, SchemaWith(1, 0), Session);

        Assert.Equal("Headless • No WebSocket", msg);
    }

    [Fact]
    public void DisplayMessage_EnabledConnected_ShowsReadyWithSession()
    {
        var msg = ComponentMessageFormatter.CreateDisplayMessage(true, true, SchemaWith(1, 0), Session);

        Assert.Equal($"Ready • {Session}", msg);
    }

    // -------------------------------------------------------------------------
    // CreateErrorInfoMessage
    // -------------------------------------------------------------------------

    [Fact]
    public void ErrorInfoMessage_PrefixesWithError()
    {
        Assert.Equal("ERROR: boom", ComponentMessageFormatter.CreateErrorInfoMessage("boom"));
    }
}
