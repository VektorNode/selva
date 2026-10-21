using System.Net;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.SelvaUpload.Services;
using Selva.Schema.Models;

namespace Selva.Tests;

public class SelvaUploadServiceTests
{
    private const string Origin = "https://selva.example.com";
    private const string Facade = "44444444-4444-4444-8444-444444444444";
    private const string Roof = "55555555-5555-4555-8555-555555555555";
    private const string DocumentId = "66666666-6666-4666-8666-666666666666";

    private readonly FakeSelva _selva = new();

    private SelvaUploadService Service() =>
        new(new SelvaApiClient(Origin, "selva_key", "ua", _selva), userId: "user-me", orgId: "org-1");

    private static SelvaDefinitionDefaults Defaults() =>
        new() { DisplayName = "Facade panel", Tags = new List<string>() };

    private static SelvaUploadFile File() => new() { Name = "facade.gh", SizeBytes = 1234 };

    // -------------------------------------------------------------------------
    // Targets
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Targets_OfferOnlyProjectsInTheOrgTheUserCanCreateIn()
    {
        var targets = await Service().ListTargetsAsync(null, null, Defaults(), File(), CancellationToken.None);

        Assert.Equal(new[] { "project-tower" }, targets.Projects.Select(p => p.Id));
        Assert.Null(targets.Suggestion);
        Assert.Empty(targets.Matches);
    }

    [Fact]
    public async Task Targets_SuggestTheLinkedDefinitionAndWhatWasUploadedSince()
    {
        var link = new SelvaDefinitionLink
            { Origin = Origin, DefinitionGuid = Facade, VersionId = "v3", VersionNumber = 3 };

        var targets = await Service().ListTargetsAsync(link, null, Defaults(), File(), CancellationToken.None);

        var suggestion = targets.Suggestion!;
        Assert.Equal("Facade panel", suggestion.DisplayName);
        Assert.Equal("Tower", suggestion.ProjectName);
        Assert.Equal(5, suggestion.LatestVersionNumber);
        Assert.Equal(4, suggestion.LiveVersionNumber);
        Assert.Equal(3, suggestion.LinkedVersionNumber);
        Assert.Equal(new[] { 5, 4 }, suggestion.NewerVersions.Select(v => v.VersionNumber));
        Assert.True(suggestion.NewerVersions[0].ByYou);
        Assert.False(suggestion.NewerVersions[1].ByYou);
        Assert.Equal("Thicker mullions", suggestion.NewerVersions[1].ChangeNote);
    }

    [Fact]
    public async Task Targets_DropALinkTheUserCanNoLongerEdit()
    {
        _selva.FacadeCanEdit = false;
        var link = new SelvaDefinitionLink
            { Origin = Origin, DefinitionGuid = Facade, VersionId = "v3", VersionNumber = 3 };

        var targets = await Service().ListTargetsAsync(link, null, Defaults(), File(), CancellationToken.None);

        Assert.Null(targets.Suggestion);
    }

    [Fact]
    public async Task Targets_DropALinkToADeletedDefinition()
    {
        var link = new SelvaDefinitionLink
        {
            Origin = Origin, DefinitionGuid = "77777777-7777-4777-8777-777777777777", VersionId = "v1",
            VersionNumber = 1
        };

        var targets = await Service().ListTargetsAsync(link, null, Defaults(), File(), CancellationToken.None);

        Assert.Null(targets.Suggestion);
    }

    [Fact]
    public async Task Targets_FindOtherUploadsOfTheSameDocument()
    {
        var link = new SelvaDefinitionLink
            { Origin = Origin, DefinitionGuid = Facade, VersionId = "v3", VersionNumber = 3 };

        var targets = await Service().ListTargetsAsync(link, DocumentId, Defaults(), File(),
            CancellationToken.None);

        var match = Assert.Single(targets.Matches);
        Assert.Equal(Roof, match.DefinitionGuid);
        Assert.Null(match.LinkedVersionNumber);
        Assert.Empty(match.NewerVersions);
        Assert.Contains(_selva.Seen, path => path.Contains("documentId=" + DocumentId));
    }

    // A server that ignored ?documentId= would list everything; only same-document rows count.
    [Fact]
    public async Task Targets_IgnoreListedDefinitionsFromOtherDocuments()
    {
        _selva.IgnoreDocumentFilter = true;

        var targets = await Service().ListTargetsAsync(null, DocumentId, Defaults(), File(),
            CancellationToken.None);

        Assert.Equal(new[] { Roof }, targets.Matches.Select(m => m.DefinitionGuid));
    }

    // -------------------------------------------------------------------------
    // Upload
    // -------------------------------------------------------------------------

    [Fact]
    public async Task NewDefinition_IsCreatedAsADraftAndLinked()
    {
        var stages = new List<string>();
        var (result, link) = await Service().UploadAsync(new SelvaUploadRequest
        {
            Kind = "newDefinition",
            ProjectId = "project-tower",
            DisplayName = "Facade panel",
            Description = "Panels",
            Category = "Facade",
            Tags = new List<string> { "tower", "panel" },
            MakeLive = false
        }, new byte[] { 1, 2, 3 }, "facade.gh", stages.Add, CancellationToken.None);

        Assert.True(result.Ok, result.Error);
        Assert.False(result.Live);
        Assert.Equal(1, result.VersionNumber);
        Assert.Equal($"{Origin}/library/{_selva.CreatedGuid}", result.Url);
        Assert.Equal(new[] { "uploading" }, stages);
        Assert.Equal("project-tower", _selva.Form["projectId"]);
        Assert.Equal("tower,panel", _selva.Form["tags"]);
        Assert.Equal("facade.gh", _selva.FileName);
        Assert.False(_selva.Published);
        Assert.Equal(new SelvaDefinitionLink
            { Origin = Origin, DefinitionGuid = _selva.CreatedGuid, VersionId = "ver-1", VersionNumber = 1 }.VersionId,
            link!.VersionId);
    }

    [Fact]
    public async Task NewVersion_WithMakeLive_IsPublished()
    {
        var stages = new List<string>();
        var (result, link) = await Service().UploadAsync(new SelvaUploadRequest
        {
            Kind = "newVersion", DefinitionGuid = Facade, ChangeNote = "Wider", MakeLive = true
        }, new byte[] { 1 }, "facade.gh", stages.Add, CancellationToken.None);

        Assert.True(result.Ok, result.Error);
        Assert.True(result.Live);
        Assert.Equal(6, result.VersionNumber);
        Assert.Equal(new[] { "uploading", "publishing" }, stages);
        Assert.Equal("Wider", _selva.Form["changeNote"]);
        Assert.Equal("ver-6", _selva.PublishedVersionId);
        Assert.Equal(6, link!.VersionNumber);
    }

    [Fact]
    public async Task MakeLive_ThatFails_StillReportsTheUploadAndLinksIt()
    {
        _selva.PublishStatus = HttpStatusCode.Forbidden;

        var (result, link) = await Service().UploadAsync(new SelvaUploadRequest
        {
            Kind = "newVersion", DefinitionGuid = Facade, MakeLive = true
        }, new byte[] { 1 }, "facade.gh", _ => { }, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.False(result.Live);
        Assert.Contains("live", result.Error);
        Assert.NotNull(link);
    }

    [Fact]
    public async Task Rejected_Upload_ReportsSelvasReason()
    {
        _selva.UploadStatus = (HttpStatusCode)422;

        var (result, link) = await Service().UploadAsync(new SelvaUploadRequest
        {
            Kind = "newVersion", DefinitionGuid = Facade, MakeLive = false
        }, new byte[] { 1 }, "facade.gh", _ => { }, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal("No Schema output", result.Error);
        Assert.Null(link);
    }

    [Theory]
    [InlineData("newVersion", null, null, null)]
    [InlineData("newVersion", "../projects", null, null)]
    [InlineData("newDefinition", null, null, "Name")]
    [InlineData("newDefinition", null, "project-tower", "  ")]
    public async Task Incomplete_Request_IsRefusedBeforeSending(string kind, string? guid, string? projectId,
        string? name)
    {
        var (result, _) = await Service().UploadAsync(new SelvaUploadRequest
        {
            Kind = kind, DefinitionGuid = guid, ProjectId = projectId, DisplayName = name, MakeLive = false
        }, new byte[] { 1 }, "facade.gh", _ => { }, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Empty(_selva.Seen);
    }

    [Fact]
    public async Task Cancelled_Upload_ReportsCancelled()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var (result, _) = await Service().UploadAsync(new SelvaUploadRequest
        {
            Kind = "newVersion", DefinitionGuid = Facade, MakeLive = false
        }, new byte[] { 1 }, "facade.gh", _ => { }, cts.Token);

        Assert.False(result.Ok);
        Assert.True(result.Cancelled);
    }

    // -------------------------------------------------------------------------

    private sealed class FakeSelva : HttpMessageHandler
    {
        public bool FacadeCanEdit = true;
        public bool IgnoreDocumentFilter;
        public HttpStatusCode UploadStatus = HttpStatusCode.Created;
        public HttpStatusCode PublishStatus = HttpStatusCode.OK;
        public readonly List<string> Seen = new();
        public Dictionary<string, string> Form = new();
        public string? FileName;
        public string CreatedGuid = "88888888-8888-4888-8888-888888888888";
        public bool Published;
        public string? PublishedVersionId;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var uri = request.RequestUri!;
            Seen.Add(uri.PathAndQuery);
            var path = uri.AbsolutePath;

            if (request.Content is MultipartFormDataContent multipart)
            {
                foreach (var part in multipart)
                {
                    var name = part.Headers.ContentDisposition!.Name!.Trim('"');
                    if (name == "file")
                    {
                        FileName = part.Headers.ContentDisposition.FileName?.Trim('"');
                    }
                    else
                    {
                        Form[name] = await part.ReadAsStringAsync();
                    }
                }
            }

            switch (request.Method.Method, path)
            {
                case ("GET", "/api/v1/projects"):
                    return Json(new JObject
                    {
                        ["items"] = new JArray(
                            Project("project-tower", "Tower", "org-1", true),
                            Project("project-archive", "Archive", "org-1", false),
                            Project("project-elsewhere", "Elsewhere", "org-2", true))
                    });

                case ("GET", "/api/v1/definitions") when uri.Query.Contains("documentId="):
                    return Json(new JObject
                    {
                        ["items"] = IgnoreDocumentFilter
                            ? new JArray(Item(Roof, DocumentId), Item("99999999-9999-4999-8999-999999999999", "other"))
                            : new JArray(Item(Facade, DocumentId), Item(Roof, DocumentId))
                    });

                case ("GET", "/api/v1/definitions/" + Facade):
                    return Json(Definition(Facade, "Facade panel", FacadeCanEdit, live: 4, draft: 5));

                case ("GET", "/api/v1/definitions/" + Roof):
                    return Json(Definition(Roof, "Roof", true, live: 2, draft: 2));

                case ("GET", "/api/v1/definitions/" + Facade + "/versions"):
                    return Json(new JObject
                    {
                        ["items"] = new JArray(
                            Version(5, "user-me", null),
                            Version(4, "user-other", "Thicker mullions"),
                            Version(3, "user-me", null),
                            Version(2, "user-me", null))
                    });

                case ("GET", "/api/v1/definitions/" + Roof + "/versions"):
                    return Json(new JObject { ["items"] = new JArray(Version(2, "user-other", null)) });

                case ("POST", "/api/v1/definitions"):
                    return UploadStatus != HttpStatusCode.Created
                        ? Json(new JObject { ["message"] = "No Schema output" }, UploadStatus)
                        : Json(new JObject
                        {
                            ["guid"] = CreatedGuid,
                            ["version"] = new JObject { ["id"] = "ver-1", ["versionNumber"] = 1 }
                        }, HttpStatusCode.Created);

                case ("POST", "/api/v1/definitions/" + Facade + "/versions"):
                    return UploadStatus != HttpStatusCode.Created
                        ? Json(new JObject { ["message"] = "No Schema output" }, UploadStatus)
                        : Json(new JObject
                        {
                            ["version"] = new JObject { ["id"] = "ver-6", ["versionNumber"] = 6 }
                        }, HttpStatusCode.Created);

                case ("POST", "/api/v1/definitions/" + Facade + "/publish"):
                    PublishedVersionId = (string?)JObject.Parse(await request.Content!.ReadAsStringAsync())["versionId"];
                    Published = PublishStatus == HttpStatusCode.OK;
                    return Published
                        ? Json(new JObject { ["version"] = new JObject { ["id"] = PublishedVersionId } })
                        : Json(new JObject { ["message"] = "Missing scope" }, PublishStatus);
            }

            return Json(new JObject { ["message"] = "Not found" }, HttpStatusCode.NotFound);
        }

        private static JObject Project(string id, string name, string orgId, bool canCreate) => new()
        {
            ["id"] = id, ["name"] = name, ["orgId"] = orgId, ["canCreateDefinitions"] = canCreate
        };

        private static JObject Item(string guid, string documentId) => new()
        {
            ["guid"] = guid, ["projectId"] = "project-tower", ["displayName"] = guid == Roof ? "Roof" : "x",
            ["sourceDocumentId"] = documentId
        };

        private static JObject Definition(string guid, string name, bool canEdit, int live, int draft) => new()
        {
            ["guid"] = guid,
            ["displayName"] = name,
            ["projectId"] = "project-tower",
            ["canEdit"] = canEdit,
            ["liveVersion"] = new JObject { ["id"] = "ver-" + live, ["versionNumber"] = live },
            ["draftVersion"] = new JObject { ["id"] = "ver-" + draft, ["versionNumber"] = draft }
        };

        private static JObject Version(int number, string by, string? note) => new()
        {
            ["id"] = "ver-" + number,
            ["versionNumber"] = number,
            ["uploadedAt"] = $"2026-01-{10 + number:00}T09:00:00Z",
            ["uploadedBy"] = by,
            ["changeNote"] = note
        };

        private static HttpResponseMessage Json(JObject body, HttpStatusCode status = HttpStatusCode.OK) =>
            new(status) { Content = new StringContent(body.ToString(), Encoding.UTF8, "application/json") };
    }
}
