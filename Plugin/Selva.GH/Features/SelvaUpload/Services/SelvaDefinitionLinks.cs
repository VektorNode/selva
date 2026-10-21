#nullable enable
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>Where this file was last uploaded on one instance.</summary>
public sealed class SelvaDefinitionLink
{
    [JsonProperty("origin")] public string Origin { get; set; } = string.Empty;
    [JsonProperty("definitionGuid")] public string DefinitionGuid { get; set; } = string.Empty;
    [JsonProperty("versionId")] public string VersionId { get; set; } = string.Empty;
    [JsonProperty("versionNumber")] public int VersionNumber { get; set; }
}

/// <summary>
///     The UI Bridge component's record of where its file went, one link per instance, saved in the
///     component's archive chunk next to Schema and Values. Not in the UI schema: the schema is shared
///     with every host and exported in .sls files, while a link belongs to one instance.
/// </summary>
public static class SelvaDefinitionLinks
{
    public const string ArchiveItem = "SelvaLinks";

    /// <summary>Anything unreadable is no links: the dialog then offers a new definition.</summary>
    public static List<SelvaDefinitionLink> Parse(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return new List<SelvaDefinitionLink>();
        }

        try
        {
            return (JsonConvert.DeserializeObject<List<SelvaDefinitionLink>>(json!) ?? new List<SelvaDefinitionLink>())
                .Where(l => l != null && SelvaOrigin.IsOnOrigin(l.Origin, l.Origin) && l.VersionNumber > 0 &&
                            System.Guid.TryParse(l.DefinitionGuid, out _))
                .ToList();
        }
        catch (JsonException)
        {
            return new List<SelvaDefinitionLink>();
        }
    }

    public static string Serialize(IEnumerable<SelvaDefinitionLink> links)
    {
        return JsonConvert.SerializeObject(links);
    }

    public static SelvaDefinitionLink? For(IEnumerable<SelvaDefinitionLink> links, string origin)
    {
        return links.FirstOrDefault(l => l.Origin == origin);
    }

    public static List<SelvaDefinitionLink> With(IEnumerable<SelvaDefinitionLink> links, SelvaDefinitionLink link)
    {
        return links.Where(l => l.Origin != link.Origin).Append(link).ToList();
    }
}
