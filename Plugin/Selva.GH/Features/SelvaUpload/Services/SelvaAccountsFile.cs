#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>What the plugin remembers about one instance it signed in to. Nothing in it is secret.</summary>
public sealed class SelvaAccountRecord
{
    [JsonProperty("origin")] public string Origin { get; set; } = string.Empty;

    /// <summary>Absent once signed out: the origin stays so the user can pick it again.</summary>
    [JsonProperty("email")] public string? Email { get; set; }

    [JsonProperty("userId")] public string? UserId { get; set; }

    [JsonProperty("displayName")] public string? DisplayName { get; set; }
    [JsonProperty("orgId")] public string? OrgId { get; set; }
    [JsonProperty("orgName")] public string? OrgName { get; set; }
    [JsonProperty("expiresAt")] public string? ExpiresAt { get; set; }
    [JsonProperty("scopes")] public List<string> Scopes { get; set; } = new();
    [JsonProperty("storage")] public string? Storage { get; set; }
}

/// <summary>The instances this machine has signed in to, as plain JSON next to the plugin's settings.</summary>
public sealed class SelvaAccountsFile
{
    [JsonProperty("activeOrigin")] public string? ActiveOrigin { get; set; }
    [JsonProperty("accounts")] public List<SelvaAccountRecord> Accounts { get; set; } = new();

    public SelvaAccountRecord? Find(string? origin)
    {
        return Accounts.FirstOrDefault(a => a.Origin == origin);
    }

    public void Upsert(SelvaAccountRecord record)
    {
        Accounts.RemoveAll(a => a.Origin == record.Origin);
        Accounts.Add(record);
    }

    /// <summary>A missing or unreadable file is an empty list: it only saves the user some typing.</summary>
    public static SelvaAccountsFile Load(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                var file = JsonConvert.DeserializeObject<SelvaAccountsFile>(File.ReadAllText(path));
                if (file != null)
                {
                    file.Accounts.RemoveAll(a => a == null || !SelvaOrigin.IsOnOrigin(a.Origin, a.Origin));
                    return file;
                }
            }
        }
        catch (Exception ex) when (ex is IOException || ex is JsonException || ex is UnauthorizedAccessException)
        {
            // Fall through to an empty list.
        }

        return new SelvaAccountsFile();
    }

    /// <summary>Written to a temp file and moved over, so a crash mid-write can't leave half a file.</summary>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonConvert.SerializeObject(this, Formatting.Indented));
        if (File.Exists(path))
        {
            File.Replace(temp, path, null);
        }
        else
        {
            File.Move(temp, path);
        }
    }
}
