#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     What the upload dialog offers and what it does, against one signed-in instance. Nothing here
///     picks a target on the user's behalf: the suggestion and matches are shown and confirmed.
/// </summary>
public sealed class SelvaUploadService
{
    private const int MaxProjectPages = 10;
    private const int MaxMatches = 5;

    private readonly SelvaApiClient _client;
    private readonly string _orgId;
    private readonly string? _userId;

    public SelvaUploadService(SelvaApiClient client, string? userId, string orgId)
    {
        _client = client;
        _userId = userId;
        _orgId = orgId;
    }

    public async Task<SelvaTargets> ListTargetsAsync(SelvaDefinitionLink? link, string? documentId,
        SelvaDefinitionDefaults defaults, SelvaUploadFile file, CancellationToken cancellationToken)
    {
        var projects = await ListProjectsAsync(cancellationToken).ConfigureAwait(false);
        var projectNames = projects.ToDictionary(p => p.Id, p => p.Name);

        var suggestion = link != null
            ? await TargetAsync(link.DefinitionGuid, link.VersionNumber, projectNames, cancellationToken)
                .ConfigureAwait(false)
            : null;

        var matches = new List<SelvaVersionTarget>();
        if (documentId != null && Guid.TryParse(documentId, out _))
        {
            var listed = await _client.GetJsonAsync(
                    $"/api/v1/definitions?documentId={Uri.EscapeDataString(documentId)}&limit=20",
                    cancellationToken)
                .ConfigureAwait(false);
            var guids = Items(listed)
                .Where(item => (string?)item["sourceDocumentId"] == documentId)
                .Select(item => (string?)item["guid"])
                .OfType<string>()
                .Where(guid => guid != suggestion?.DefinitionGuid)
                .Distinct()
                .Take(MaxMatches);

            foreach (var guid in guids)
            {
                var target = await TargetAsync(guid, null, projectNames, cancellationToken).ConfigureAwait(false);
                if (target != null)
                {
                    matches.Add(target);
                }
            }
        }

        return new SelvaTargets
        {
            Origin = _client.Origin,
            Projects = projects.Where(p => p.CanCreate).Select(p => new SelvaProject { Id = p.Id, Name = p.Name })
                .ToList(),
            Suggestion = suggestion,
            Matches = matches,
            Defaults = defaults,
            File = file
        };
    }

    /// <summary>
    ///     Uploads as the definition's draft, then makes it live when asked. A failed make-live
    ///     still returns the link: the version exists on Selva either way.
    /// </summary>
    public async Task<(SelvaUploadResult Result, SelvaDefinitionLink? Link)> UploadAsync(
        SelvaUploadRequest request, byte[] file, string fileName, Action<string> onStage,
        CancellationToken cancellationToken)
    {
        var refusal = Validate(request);
        if (refusal != null)
        {
            return (new SelvaUploadResult { Ok = false, Error = refusal }, null);
        }

        string guid;
        JToken? version;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            onStage("uploading");

            if (request.Kind == "newDefinition")
            {
                var created = await _client.PostMultipartAsync("/api/v1/definitions", () =>
                {
                    var form = FileForm(file, fileName);
                    form.Add(new StringContent(request.ProjectId!), "projectId");
                    form.Add(new StringContent(request.DisplayName!.Trim()), "displayName");
                    AddIfPresent(form, "description", request.Description);
                    AddIfPresent(form, "category", request.Category);
                    if (request.Tags is { Count: > 0 })
                    {
                        form.Add(new StringContent(string.Join(",", request.Tags)), "tags");
                    }

                    return form;
                }, cancellationToken).ConfigureAwait(false);
                guid = (string?)created["guid"] ?? throw new SelvaApiException("Selva didn't say what it created.");
                version = created["version"];
            }
            else
            {
                guid = request.DefinitionGuid!;
                var uploaded = await _client.PostMultipartAsync(
                    $"/api/v1/definitions/{guid}/versions", () =>
                    {
                        var form = FileForm(file, fileName);
                        AddIfPresent(form, "changeNote", request.ChangeNote);
                        return form;
                    }, cancellationToken).ConfigureAwait(false);
                version = uploaded["version"];
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return (new SelvaUploadResult { Ok = false, Cancelled = true, Error = "Upload cancelled." }, null);
        }
        catch (SelvaApiException ex) when (!ex.InvalidToken)
        {
            return (new SelvaUploadResult { Ok = false, Error = ex.Message }, null);
        }

        var versionId = (string?)version?["id"];
        var versionNumber = (int?)version?["versionNumber"];
        if (versionId == null || versionNumber == null)
        {
            return (new SelvaUploadResult { Ok = false, Error = "Selva didn't say which version it made." }, null);
        }

        var link = new SelvaDefinitionLink
        {
            Origin = _client.Origin, DefinitionGuid = guid, VersionId = versionId, VersionNumber = versionNumber.Value
        };
        var result = new SelvaUploadResult
        {
            Ok = true,
            DefinitionGuid = guid,
            DisplayName = request.Kind == "newDefinition" ? request.DisplayName!.Trim() : null,
            VersionNumber = versionNumber,
            Live = false,
            Url = $"{_client.Origin}/library/{guid}"
        };

        if (request.MakeLive)
        {
            onStage("publishing");
            try
            {
                await _client.PostJsonAsync($"/api/v1/definitions/{guid}/publish",
                    new JObject { ["versionId"] = versionId }, CancellationToken.None).ConfigureAwait(false);
                result.Live = true;
            }
            catch (SelvaApiException ex)
            {
                result.Error = $"Uploaded as version {versionNumber}, but making it live failed: {ex.Message}";
            }
        }

        return (result, link);
    }

    // ============================================================================
    // Internals
    // ============================================================================

    private sealed class ProjectRow
    {
        public string Id = string.Empty;
        public string Name = string.Empty;
        public bool CanCreate;
    }

    private static string? Validate(SelvaUploadRequest request)
    {
        if (request.Kind == "newVersion")
        {
            return Guid.TryParse(request.DefinitionGuid, out _) ? null : "Pick the definition to add a version to.";
        }

        if (request.Kind != "newDefinition")
        {
            return "Pick where to upload.";
        }

        if (string.IsNullOrWhiteSpace(request.ProjectId))
        {
            return "Pick a project.";
        }

        return string.IsNullOrWhiteSpace(request.DisplayName) ? "Give the definition a name." : null;
    }

    private async Task<List<ProjectRow>> ListProjectsAsync(CancellationToken cancellationToken)
    {
        var rows = new List<ProjectRow>();
        string? cursor = null;
        for (var page = 0; page < MaxProjectPages; page++)
        {
            var path = "/api/v1/projects?limit=100" +
                       (cursor != null ? "&cursor=" + Uri.EscapeDataString(cursor) : string.Empty);
            var json = await _client.GetJsonAsync(path, cancellationToken).ConfigureAwait(false);
            foreach (var item in Items(json))
            {
                var id = (string?)item["id"];
                // A key is bound to one org; a project from another can't take its upload.
                if (id == null || (string?)item["orgId"] != _orgId)
                {
                    continue;
                }

                rows.Add(new ProjectRow
                {
                    Id = id,
                    Name = (string?)item["name"] ?? id,
                    CanCreate = item["canCreateDefinitions"]?.Type != JTokenType.Boolean ||
                                (bool)item["canCreateDefinitions"]!
                });
            }

            cursor = (string?)json["nextCursor"];
            if (string.IsNullOrEmpty(cursor))
            {
                break;
            }
        }

        return rows;
    }

    /// <summary>Null when the definition is gone or the user can no longer edit it.</summary>
    private async Task<SelvaVersionTarget?> TargetAsync(string guid, int? linkedVersion,
        Dictionary<string, string> projectNames, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(guid, out _))
        {
            return null;
        }

        JObject definition;
        try
        {
            definition = await _client.GetJsonAsync($"/api/v1/definitions/{guid}", cancellationToken)
                .ConfigureAwait(false);
        }
        catch (SelvaApiException ex) when (ex.Status == 404 || ex.Status == 403)
        {
            return null;
        }

        if (definition["canEdit"]?.Type == JTokenType.Boolean && !(bool)definition["canEdit"]!)
        {
            return null;
        }

        var versions = Items(await _client.GetJsonAsync($"/api/v1/definitions/{guid}/versions?limit=20",
                cancellationToken).ConfigureAwait(false))
            .Where(v => v["versionNumber"]?.Type == JTokenType.Integer)
            .ToList();

        var live = VersionNumberOf(definition["liveVersion"]);
        var latest = new[] { VersionNumberOf(definition["draftVersion"]), live }
            .Concat(versions.Select(v => (int?)v["versionNumber"]))
            .Max() ?? 0;

        var projectId = (string?)definition["projectId"];
        return new SelvaVersionTarget
        {
            DefinitionGuid = guid,
            DisplayName = (string?)definition["displayName"] ?? guid,
            ProjectName = projectId != null && projectNames.TryGetValue(projectId, out var name) ? name : null,
            LatestVersionNumber = latest,
            LiveVersionNumber = live,
            LinkedVersionNumber = linkedVersion,
            NewerVersions = linkedVersion == null
                ? new List<SelvaVersionSummary>()
                : versions
                    .Where(v => (int)v["versionNumber"]! > linkedVersion)
                    .OrderByDescending(v => (int)v["versionNumber"]!)
                    .Select(v => new SelvaVersionSummary
                    {
                        VersionNumber = (int)v["versionNumber"]!,
                        UploadedAt = (string?)v["uploadedAt"] ?? string.Empty,
                        ByYou = _userId != null && (string?)v["uploadedBy"] == _userId,
                        ChangeNote = (string?)v["changeNote"]
                    })
                    .ToList()
        };
    }

    // `liveVersion` is JSON null until the first publish, and indexing a JValue throws.
    private static int? VersionNumberOf(JToken? version)
    {
        var number = (version as JObject)?["versionNumber"];
        return number?.Type == JTokenType.Integer ? (int)number : null;
    }

    private static IEnumerable<JObject> Items(JObject collection)
    {
        return (collection["items"] as JArray)?.OfType<JObject>() ?? Enumerable.Empty<JObject>();
    }

    private static MultipartFormDataContent FileForm(byte[] file, string fileName)
    {
        var content = new ByteArrayContent(file);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        return new MultipartFormDataContent { { content, "file", fileName } };
    }

    private static void AddIfPresent(MultipartFormDataContent form, string name, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            form.Add(new StringContent(value!.Trim()), name);
        }
    }
}
