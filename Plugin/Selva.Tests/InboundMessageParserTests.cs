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

    private static InboundMessage Parse(string json, string session = Session) =>
        new InboundMessageParser(WireJson.Serializer).Parse(json, session);

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
    // draftLayout
    // -------------------------------------------------------------------------

    [Fact]
    public void DraftLayout_BindsLocations_FirstPlacementWins()
    {
        var msg = Parse(@"{ ""type"": ""draftLayout"", ""sessionId"": ""session-1"", ""placements"": [
                           { ""paramId"": ""00000000-0000-0000-0000-000000000001"", ""tabLabel"": ""General"", ""groupLabel"": ""Size"" },
                           { ""paramId"": ""00000000-0000-0000-0000-000000000001"", ""tabLabel"": null, ""groupLabel"": ""Other"" } ] }");

        Assert.Equal(InboundKind.DraftLayout, msg.Kind);
        var location = Assert.Single(msg.DraftLocations).Value;
        Assert.Equal("General › Size", location.Path);
    }

    [Fact]
    public void DraftLayout_Null_ClearsTheDraft()
    {
        var msg = Parse(@"{ ""type"": ""draftLayout"", ""sessionId"": ""session-1"", ""placements"": null }");

        Assert.Equal(InboundKind.DraftLayout, msg.Kind);
        Assert.Null(msg.DraftLocations);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""draftLayout"", ""sessionId"": ""session-1"" }")]
    [InlineData(@"{ ""type"": ""draftLayout"", ""sessionId"": ""session-1"", ""placements"": [ { ""paramId"": ""nope"", ""groupLabel"": ""A"" } ] }")]
    [InlineData(@"{ ""type"": ""draftLayout"", ""sessionId"": ""session-1"", ""placements"": [ { ""paramId"": {}, ""groupLabel"": ""A"" } ] }")]
    public void DraftLayout_Malformed_IsMissingField(string json)
    {
        Assert.Equal(InboundKind.MissingField, Parse(json).Kind);
    }

    // -------------------------------------------------------------------------
    // readLayout / applyLayout
    // -------------------------------------------------------------------------

    [Fact]
    public void ReadLayout_CarriesTheRequestId()
    {
        var msg = Parse(@"{ ""type"": ""readLayout"", ""sessionId"": ""session-1"", ""requestId"": ""r1"" }");

        Assert.Equal(InboundKind.ReadLayout, msg.Kind);
        Assert.Equal("r1", msg.RequestId);
    }

    [Fact]
    public void ApplyLayout_PassesTheSpecOnAsJson()
    {
        var msg = Parse(@"{ ""type"": ""applyLayout"", ""sessionId"": ""session-1"", ""requestId"": ""r2"",
                           ""spec"": { ""name"": ""Tower"", ""tabs"": [] } }");

        Assert.Equal(InboundKind.ApplyLayout, msg.Kind);
        Assert.Equal("r2", msg.RequestId);
        Assert.Equal(@"{""name"":""Tower"",""tabs"":[]}", msg.LayoutSpec);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""applyLayout"", ""sessionId"": ""session-1"" }")]
    [InlineData(@"{ ""type"": ""applyLayout"", ""sessionId"": ""session-1"", ""spec"": ""{}"" }")]
    public void ApplyLayout_WithoutASpecObject_IsMissingField(string json)
    {
        Assert.Equal(InboundKind.MissingField, Parse(json).Kind);
    }

    // -------------------------------------------------------------------------
    // requestCurrentValues / requestInitialData
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
        Assert.False(msg.SchemaOnly);
    }

    [Theory]
    [InlineData(@"true", true)]
    [InlineData(@"false", false)]
    [InlineData(@"""yes""", false)]
    public void RequestInitialData_ReadsSchemaOnly(string value, bool expected)
    {
        var msg = Parse(@"{ ""type"": ""requestInitialData"", ""sessionId"": ""session-1"", ""schemaOnly"": " + value + " }");
        Assert.Equal(InboundKind.RequestInitialData, msg.Kind);
        Assert.Equal(expected, msg.SchemaOnly);
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

    // -------------------------------------------------------------------------
    // hostSaveFile / hostPickFile
    // -------------------------------------------------------------------------

    [Fact]
    public void HostSaveFile_BindsRequestIdAndFileName()
    {
        var msg = Parse(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"",
                           ""requestId"": ""7"", ""fileName"": ""facade.zip"" }");

        Assert.Equal(InboundKind.HostSaveFile, msg.Kind);
        Assert.Equal("7", msg.RequestId);
        Assert.Equal("facade.zip", msg.FileName);
    }

    // The name is only a suggestion in the Save dialog, but it must never steer the folder.
    [Theory]
    [InlineData("../../etc/facade.zip", "facade.zip")]
    [InlineData("C:\\Users\\x\\facade.zip", "facade.zip")]
    [InlineData("  facade.zip  ", "facade.zip")]
    [InlineData("folder/", "download")]
    [InlineData("..", "download")]
    public void HostSaveFile_KeepsOnlyTheBareFileName(string fileName, string expected)
    {
        var msg = Parse(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"", ""requestId"": ""7"",
                           ""fileName"": " + Newtonsoft.Json.JsonConvert.ToString(fileName) + " }");

        Assert.Equal(expected, msg.FileName);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"", ""fileName"": ""a.zip"" }")]
    [InlineData(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"", ""requestId"": """", ""fileName"": ""a.zip"" }")]
    [InlineData(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"", ""requestId"": 7, ""fileName"": ""a.zip"" }")]
    [InlineData(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"", ""requestId"": ""7"" }")]
    [InlineData(@"{ ""type"": ""hostPickFile"", ""sessionId"": ""session-1"", ""requestId"": ""7"" }")]
    [InlineData(@"{ ""type"": ""hostPickFile"", ""sessionId"": ""session-1"", ""accept"": [] }")]
    public void HostMessages_WithoutTheirFields_AreMissingField(string json)
    {
        Assert.Equal(InboundKind.MissingField, Parse(json).Kind);
    }

    [Fact]
    public void HostSaveFile_WithAnOverlongRequestId_IsMissingField()
    {
        var msg = Parse(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"",
                           ""requestId"": """ + new string('x', 65) + @""", ""fileName"": ""a.zip"" }");

        Assert.Equal(InboundKind.MissingField, msg.Kind);
    }

    // The transport fails these by requestId, or the page's save never settles.
    [Theory]
    [InlineData(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""other"", ""requestId"": ""7"", ""fileName"": ""a.zip"" }",
        InboundKind.SessionMismatch)]
    [InlineData(@"{ ""type"": ""hostSaveFile"", ""sessionId"": ""session-1"", ""requestId"": ""7"", ""fileName"": 3 }",
        InboundKind.MissingField)]
    public void HostSaveFile_ThatCannotRun_KeepsItsRequestId(string json, InboundKind kind)
    {
        var msg = Parse(json);

        Assert.Equal(kind, msg.Kind);
        Assert.Equal("7", msg.RequestId);
    }

    // -------------------------------------------------------------------------
    // exportApp
    // -------------------------------------------------------------------------

    [Fact]
    public void ExportApp_BindsRequestIdNameAndKey()
    {
        var msg = Parse(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"",
                           ""name"": ""  Tower massing "", ""key"": "" correct horse "" }");

        Assert.Equal(InboundKind.ExportApp, msg.Kind);
        Assert.Equal("5", msg.RequestId);
        Assert.Equal("Tower massing", msg.AppName);
        // Kept as typed: the person opening the app types the same characters.
        Assert.Equal(" correct horse ", msg.AppKey);
    }

    [Fact]
    public void ExportApp_BindsAPngIcon()
    {
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3 };
        var msg = Parse(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"",
                           ""name"": ""Tower"", ""icon"": """ + Convert.ToBase64String(png) + @""" }");

        Assert.Equal(InboundKind.ExportApp, msg.Kind);
        Assert.Equal(png, msg.AppIcon);
    }

    [Theory]
    [InlineData("42")]
    [InlineData(@"""not base64!""")]
    // Valid base64, but a JPEG's first bytes.
    [InlineData(@"""/9j/4AAQSkZJRg==""")]
    public void ExportApp_WithAnIconThatIsNotAPng_IsRefused(string icon)
    {
        var msg = Parse(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"",
                           ""name"": ""Tower"", ""icon"": " + icon + " }");

        Assert.Equal(InboundKind.MissingField, msg.Kind);
    }

    [Fact]
    public void ExportApp_WithAnOversizedIcon_IsRefused()
    {
        var png = new byte[Selva.AppFormat.AppFile.MaxIconBytes + 1];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(png, 0);
        var msg = Parse(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"",
                           ""name"": ""Tower"", ""icon"": """ + Convert.ToBase64String(png) + @""" }");

        Assert.Equal(InboundKind.MissingField, msg.Kind);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": ""Tower"" }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": ""Tower"", ""key"": null }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": ""Tower"", ""key"": """" }")]
    public void ExportApp_WithoutAKey_IsUnprotected(string json)
    {
        var msg = Parse(json);

        Assert.Equal(InboundKind.ExportApp, msg.Kind);
        Assert.Null(msg.AppKey);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""name"": ""Tower"" }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": """", ""name"": ""Tower"" }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"" }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": ""   "" }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": 7 }")]
    // A key that isn't text must not turn into an unprotected export.
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": ""Tower"", ""key"": 1234 }")]
    [InlineData(@"{ ""type"": ""exportApp"", ""sessionId"": ""session-1"", ""requestId"": ""5"", ""name"": ""Tower"", ""key"": [""a""] }")]
    public void ExportApp_WithoutItsFields_IsMissingField(string json)
    {
        Assert.Equal(InboundKind.MissingField, Parse(json).Kind);
    }

    // -------------------------------------------------------------------------
    // pickGeometry / clearGeometry / trigger / closeDefinition / editInGrasshopper
    // -------------------------------------------------------------------------

    private const string CurveParam = "11111111-1111-4111-8111-111111111111";

    [Fact]
    public void PickGeometry_BindsRequestIdAndParamId()
    {
        var msg = Parse(@"{ ""type"": ""pickGeometry"", ""sessionId"": ""session-1"",
                           ""requestId"": ""3"", ""paramId"": """ + CurveParam + @""" }");

        Assert.Equal(InboundKind.PickGeometry, msg.Kind);
        Assert.Equal("3", msg.RequestId);
        Assert.Equal(System.Guid.Parse(CurveParam), msg.ParamId);
    }

    [Theory]
    [InlineData("clearGeometry", InboundKind.ClearGeometry)]
    [InlineData("trigger", InboundKind.Trigger)]
    public void ParamMessages_BindTheParamId(string type, InboundKind kind)
    {
        var msg = Parse(@"{ ""type"": """ + type + @""", ""sessionId"": ""session-1"", ""paramId"": """ +
                        CurveParam + @""" }");

        Assert.Equal(kind, msg.Kind);
        Assert.Equal(System.Guid.Parse(CurveParam), msg.ParamId);
    }

    [Theory]
    [InlineData(@"{ ""type"": ""pickGeometry"", ""sessionId"": ""session-1"", ""paramId"": ""11111111-1111-4111-8111-111111111111"" }")]
    [InlineData(@"{ ""type"": ""pickGeometry"", ""sessionId"": ""session-1"", ""requestId"": ""3"" }")]
    [InlineData(@"{ ""type"": ""trigger"", ""sessionId"": ""session-1"", ""paramId"": ""not-a-guid"" }")]
    [InlineData(@"{ ""type"": ""clearGeometry"", ""sessionId"": ""session-1"" }")]
    public void ParamMessages_WithoutAParamOrRequestId_AreMissingField(string json)
    {
        Assert.Equal(InboundKind.MissingField, Parse(json).Kind);
    }

    [Theory]
    [InlineData("closeDefinition", InboundKind.CloseDefinition)]
    [InlineData("editInGrasshopper", InboundKind.EditInGrasshopper)]
    public void PlayerMessages_Classify(string type, InboundKind kind)
    {
        Assert.Equal(kind, Parse(@"{ ""type"": """ + type + @""", ""sessionId"": ""session-1"" }").Kind);
    }

    [Fact]
    public void HostPickFile_BindsTheStringAcceptEntries()
    {
        var msg = Parse(@"{ ""type"": ""hostPickFile"", ""sessionId"": ""session-1"",
                           ""requestId"": ""8"", ""accept"": ["".slvp"", 3, "".sps""] }");

        Assert.Equal(InboundKind.HostPickFile, msg.Kind);
        Assert.Equal("8", msg.RequestId);
        Assert.Equal(new[] { ".slvp", ".sps" }, msg.Accept);
    }

    [Fact]
    public void HostPickFile_FromAnotherSession_IsSessionMismatch()
    {
        var msg = Parse(@"{ ""type"": ""hostPickFile"", ""sessionId"": ""other"",
                           ""requestId"": ""8"", ""accept"": [] }");

        Assert.Equal(InboundKind.SessionMismatch, msg.Kind);
    }
}
