using Newtonsoft.Json;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.Tests;

/// <summary>
///     Tests for InboundMessageParser — the pure parse/classify half of the WebSocket inbound path.
///     No sockets, no Rhino. Mirrors the inbound message types guarded on the TS side in
///     messageSchemas.ts.
/// </summary>
public class InboundMessageParserTests
{
    private const string Session = "session-1";

    private static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            TypeNameHandling = TypeNameHandling.None,
            MetadataPropertyHandling = MetadataPropertyHandling.Ignore
        });

    private static InboundMessage Parse(string json, string session = Session) =>
        new InboundMessageParser(Serializer).Parse(json, session);

    // -------------------------------------------------------------------------
    // valueUpdate
    // -------------------------------------------------------------------------

    [Fact]
    public void ValueUpdate_WithValues_ClassifiesAndBindsPayload()
    {
        var msg = Parse(@"{ ""type"": ""valueUpdate"", ""sessionId"": ""session-1"",
                           ""values"": { ""in-count"": 3, ""in-name"": ""x"" } }");

        Assert.Equal(InboundKind.ValueUpdate, msg.Kind);
        Assert.NotNull(msg.Values);
        Assert.Equal(2, msg.Values.Count);
        Assert.Equal(3L, msg.Values["in-count"]);
        Assert.Equal("x", msg.Values["in-name"]);
    }

    [Fact]
    public void ValueUpdate_MissingValues_IsMissingField()
    {
        var msg = Parse(@"{ ""type"": ""valueUpdate"", ""sessionId"": ""session-1"" }");

        Assert.Equal(InboundKind.MissingField, msg.Kind);
        Assert.Equal("valueUpdate", msg.MessageType);
    }

    // -------------------------------------------------------------------------
    // requestCurrentValues / requestInitialData (no payload)
    // -------------------------------------------------------------------------

    [Fact]
    public void RequestCurrentValues_Classifies()
    {
        var msg = Parse(@"{ ""type"": ""requestCurrentValues"", ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.RequestCurrentValues, msg.Kind);
    }

    [Fact]
    public void RequestInitialData_Classifies()
    {
        var msg = Parse(@"{ ""type"": ""requestInitialData"", ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.RequestInitialData, msg.Kind);
    }

    // initialData carries the whole schema and the current values, so it is session-checked like
    // every other message.
    [Theory]
    [InlineData(@"{ ""type"": ""requestInitialData"", ""sessionId"": ""some-other-session"" }")]
    [InlineData(@"{ ""type"": ""requestInitialData"" }")]
    public void RequestInitialData_FromAnotherSession_IsRefused(string json)
    {
        Assert.Equal(InboundKind.SessionMismatch, Parse(json).Kind);
    }

    // -------------------------------------------------------------------------
    // saveSchema
    // -------------------------------------------------------------------------

    [Fact]
    public void SaveSchema_WithSchema_BindsSchemaAndBaseHash()
    {
        var msg = Parse(@"{ ""type"": ""saveSchema"", ""sessionId"": ""session-1"",
                           ""baseSchemaHash"": ""hash-abc"",
                           ""schema"": { ""id"": ""s1"", ""name"": ""S1"" } }");

        Assert.Equal(InboundKind.SaveSchema, msg.Kind);
        Assert.NotNull(msg.Schema);
        Assert.Equal("hash-abc", msg.BaseSchemaHash);
    }

    [Fact]
    public void SaveSchema_MissingBaseHash_IsTolerated()
    {
        var msg = Parse(@"{ ""type"": ""saveSchema"", ""sessionId"": ""session-1"",
                           ""schema"": { ""id"": ""s1"", ""name"": ""S1"" } }");

        Assert.Equal(InboundKind.SaveSchema, msg.Kind);
        Assert.Null(msg.BaseSchemaHash);
    }

    [Fact]
    public void SaveSchema_MissingSchema_IsMissingField()
    {
        var msg = Parse(@"{ ""type"": ""saveSchema"", ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.MissingField, msg.Kind);
    }

    // -------------------------------------------------------------------------
    // requestSyncPreview / applySyncChanges
    // -------------------------------------------------------------------------

    [Fact]
    public void RequestSyncPreview_WithSchema_BindsSchema()
    {
        var msg = Parse(@"{ ""type"": ""requestSyncPreview"", ""sessionId"": ""session-1"",
                           ""schema"": { ""id"": ""s1"", ""name"": ""S1"" } }");

        Assert.Equal(InboundKind.RequestSyncPreview, msg.Kind);
        Assert.NotNull(msg.Schema);
    }

    [Fact]
    public void ApplySyncChanges_WithChanges_BindsChangeList()
    {
        var msg = Parse(@"{ ""type"": ""applySyncChanges"", ""sessionId"": ""session-1"",
                           ""changes"": [
                             { ""paramId"": ""p1"", ""field"": ""nickname"", ""direction"": ""FromGH"" }
                           ] }");

        Assert.Equal(InboundKind.ApplySyncChanges, msg.Kind);
        Assert.NotNull(msg.Changes);
        Assert.Single(msg.Changes);
        Assert.Equal("p1", msg.Changes[0].ParamId);
        Assert.Equal("nickname", msg.Changes[0].Field);
        Assert.Equal(SyncDirection.FromGH, msg.Changes[0].Direction);
    }

    [Fact]
    public void ApplySyncChanges_MissingChanges_IsMissingField()
    {
        var msg = Parse(@"{ ""type"": ""applySyncChanges"", ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.MissingField, msg.Kind);
    }

    // -------------------------------------------------------------------------
    // Session, unknown, malformed
    // -------------------------------------------------------------------------

    [Fact]
    public void SessionMismatch_OnNonInitialMessage_IsRejected()
    {
        var msg = Parse(@"{ ""type"": ""valueUpdate"", ""sessionId"": ""wrong-session"",
                           ""values"": { ""a"": 1 } }");

        Assert.Equal(InboundKind.SessionMismatch, msg.Kind);
        Assert.Equal("valueUpdate", msg.MessageType);
    }

    [Fact]
    public void UnknownType_IsUnknownNotThrow()
    {
        var msg = Parse(@"{ ""type"": ""somethingNew"", ""sessionId"": ""session-1"" }");

        Assert.Equal(InboundKind.Unknown, msg.Kind);
        Assert.Equal("somethingNew", msg.MessageType);
    }

    [Fact]
    public void MalformedJson_IsMalformedNotThrow()
    {
        var msg = Parse("{ not valid json");
        Assert.Equal(InboundKind.Malformed, msg.Kind);
    }

    [Fact]
    public void MissingType_IsMalformed()
    {
        var msg = Parse(@"{ ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.Malformed, msg.Kind);
    }

    [Fact]
    public void EmptyType_IsMalformed()
    {
        var msg = Parse(@"{ ""type"": """", ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.Malformed, msg.Kind);
    }

    // -------------------------------------------------------------------------
    // Selva account and upload
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("selvaGetAccount", InboundKind.SelvaGetAccount)]
    [InlineData("selvaSignIn", InboundKind.SelvaSignIn)]
    [InlineData("selvaUseApiKey", InboundKind.SelvaUseApiKey)]
    [InlineData("selvaSignOut", InboundKind.SelvaSignOut)]
    [InlineData("selvaListTargets", InboundKind.SelvaListTargets)]
    [InlineData("selvaCancel", InboundKind.SelvaCancel)]
    public void SelvaCommands_WithoutPayload_Classify(string type, InboundKind kind)
    {
        Assert.Equal(kind, Parse($@"{{ ""type"": ""{type}"", ""sessionId"": ""session-1"" }}").Kind);
    }

    [Fact]
    public void SelvaConnect_BindsTheOrigin()
    {
        var msg = Parse(@"{ ""type"": ""selvaConnect"", ""sessionId"": ""session-1"",
                           ""origin"": ""selva.example.com"" }");

        Assert.Equal(InboundKind.SelvaConnect, msg.Kind);
        Assert.Equal("selva.example.com", msg.Origin);
    }

    [Fact]
    public void SelvaConnect_WithoutAnOrigin_IsMissingField()
    {
        var msg = Parse(@"{ ""type"": ""selvaConnect"", ""sessionId"": ""session-1"" }");
        Assert.Equal(InboundKind.MissingField, msg.Kind);
    }

    [Fact]
    public void SelvaUpload_BindsTheRequest()
    {
        var msg = Parse(@"{ ""type"": ""selvaUpload"", ""sessionId"": ""session-1"",
                           ""request"": { ""kind"": ""newVersion"", ""makeLive"": true,
                                          ""definitionGuid"": ""44444444-4444-4444-8444-444444444444"",
                                          ""changeNote"": ""Thicker mullions"" } }");

        Assert.Equal(InboundKind.SelvaUpload, msg.Kind);
        Assert.Equal("newVersion", msg.UploadRequest.Kind);
        Assert.True(msg.UploadRequest.MakeLive);
        Assert.Equal("Thicker mullions", msg.UploadRequest.ChangeNote);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""selvaUpload"", ""sessionId"": ""session-1"" }")]
    [InlineData(@"{ ""type"": ""selvaUpload"", ""sessionId"": ""session-1"", ""request"": { ""makeLive"": true } }")]
    [InlineData(@"{ ""type"": ""selvaUpload"", ""sessionId"": ""session-1"", ""request"": { ""kind"": ""replace"", ""makeLive"": true } }")]
    [InlineData(@"{ ""type"": ""selvaUpload"", ""sessionId"": ""session-1"", ""request"": { ""kind"": ""newVersion"" } }")]
    public void SelvaUpload_WithoutAUsableRequest_IsMissingField(string json)
    {
        Assert.Equal(InboundKind.MissingField, Parse(json).Kind);
    }
}
