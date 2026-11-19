#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Selva.Schema.Models;

namespace Selva.GH.Features.Inventory.Services;

// Rhino-free: InventoryExtractor reads the document into these records, this turns them into the
// wire shape. Linked into Selva.Tests.

public sealed record ArchiveLibrary(Guid Id, string Name, string Author, string Version);

public sealed record LoadedLibrary(Guid Id, string Name, string Version);

public sealed record CanvasObject(Guid Id, Guid Type, string Name, string NickName, Guid Library, bool Obsolete);

/// <summary>An object chunk in the archive with no counterpart in the loaded document.</summary>
public sealed record ArchiveObject(Guid Id, Guid Type, string Name, Guid Library);

public sealed record CanvasValue(
    string Id,
    string? Owner,
    string Kind,
    string Label,
    string Text,
    double? Min = null,
    double? Max = null);

public sealed record CanvasScript(Guid Id, string Label, string Language, string Source);

/// <summary>
///     Both ends as "componentId/o2" (output 2) or "componentId/i0", a floating parameter's own id,
///     or "missing" for a source whose plugin did not load. Not parameter InstanceGuids: those of a
///     dangling source change on every load, and Grasshopper binds wires by index anyway.
/// </summary>
public sealed record CanvasWire(string Source, string Target);

public static class InventoryBuilder
{
    public const int MaxValueText = 500;

    // The archive's library list carries "Grasshopper" once per core assembly, with an empty id.
    static readonly string[] CoreAuthors = { "Robert McNeel & Associates" };

    static readonly JsonSerializerSettings Json = new() { NullValueHandling = NullValueHandling.Ignore };

    public static DocumentInventory Build(
        string pluginVersion,
        IEnumerable<ArchiveLibrary> saved,
        IEnumerable<LoadedLibrary> loaded,
        IEnumerable<CanvasObject> objects,
        IEnumerable<CanvasValue> values,
        IEnumerable<CanvasScript> scripts,
        IEnumerable<CanvasWire> wires,
        IEnumerable<ArchiveObject>? unloaded = null)
    {
        var loadedById = loaded.GroupBy(l => l.Id).ToDictionary(g => g.Key, g => g.First());
        var wireList = wires.Distinct().ToList();

        return new DocumentInventory
        {
            ExtractedWith = pluginVersion,
            Libraries = saved
                .GroupBy(l => l.Id == Guid.Empty ? "name:" + l.Name : l.Id.ToString())
                .Select(g => Library(g.First(), loadedById))
                .OrderBy(l => l.Core ? 0 : 1)
                .ThenBy(l => l.Name, StringComparer.OrdinalIgnoreCase)
                .ToList(),
            Components = objects
                .Select(o => new InventoryComponent
                {
                    Id = o.Id,
                    Type = o.Type,
                    Name = o.Name,
                    Nickname = o.NickName != o.Name && !string.IsNullOrEmpty(o.NickName) ? o.NickName : null,
                    Library = o.Library == Guid.Empty ? null : o.Library.ToString(),
                    Obsolete = o.Obsolete
                })
                .ToList(),
            Values = values.Select(Value).ToList(),
            Scripts = scripts.Select(Script).ToList(),
            Wires = new InventoryWires
            {
                Count = wireList.Count,
                Sha256 = Sha256(string.Join("\n", wireList
                    .Select(w => $"{w.Source}>{w.Target}")
                    .OrderBy(s => s, StringComparer.Ordinal)))
            },
            Unloaded = (unloaded ?? Enumerable.Empty<ArchiveObject>())
                .Select(o => new InventoryUnloaded
                {
                    Id = o.Id,
                    Type = o.Type,
                    Name = o.Name,
                    Library = o.Library == Guid.Empty ? null : o.Library.ToString()
                })
                .ToList()
        };
    }

    public static string ToJson(DocumentInventory inventory) => JsonConvert.SerializeObject(inventory, Json);

    static InventoryLibrary Library(ArchiveLibrary saved, Dictionary<Guid, LoadedLibrary> loaded)
    {
        var core = saved.Id == Guid.Empty && CoreAuthors.Contains(saved.Author);
        loaded.TryGetValue(saved.Id, out var onServer);
        return new InventoryLibrary
        {
            Id = saved.Id,
            Name = saved.Name,
            Author = saved.Author,
            Version = saved.Version,
            Core = core,
            ServerVersion = core ? saved.Version : onServer?.Version
        };
    }

    static InventoryValue Value(CanvasValue v)
    {
        var secrets = SecretScanner.Scan(v.Text);
        return new InventoryValue
        {
            Id = v.Id,
            Owner = v.Owner,
            Kind = v.Kind,
            Label = v.Label,
            Text = secrets.Count > 0 ? "" : Truncate(v.Text, MaxValueText),
            Sha256 = Sha256(v.Text),
            Min = v.Min,
            Max = v.Max,
            Secrets = secrets
        };
    }

    static InventoryScript Script(CanvasScript s)
    {
        var lines = SplitLines(s.Source);
        return new InventoryScript
        {
            Id = s.Id,
            Label = s.Label,
            Language = s.Language,
            Sha256 = Sha256(Normalize(s.Source)),
            LineCount = lines.Count,
            LineHashes = lines.Select(LineHash).ToList(),
            Secrets = SecretScanner.Scan(s.Source)
        };
    }

    public static string Normalize(string source) => (source ?? "").Replace("\r\n", "\n").Replace('\r', '\n');

    /// <summary>Lines with trailing whitespace trimmed and trailing blank lines dropped.</summary>
    public static List<string> SplitLines(string source)
    {
        var lines = Normalize(source).Split('\n').Select(l => l.TrimEnd()).ToList();
        while (lines.Count > 0 && lines[lines.Count - 1].Length == 0)
            lines.RemoveAt(lines.Count - 1);
        return lines;
    }

    // 32 bits per line: only compared within one script, so a collision costs one miscounted line.
    public static string LineHash(string line) => Sha256(line).Substring(0, 8);

    public static string Sha256(string text)
    {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? ""));
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    static string Truncate(string text, int max) => text.Length <= max ? text : text.Substring(0, max) + "…";

    /// <summary>"*.*.csharp@*.*" → "csharp"; RhinoCode's LanguageSpec as text.</summary>
    public static string LanguageFromSpec(string? spec)
    {
        if (string.IsNullOrEmpty(spec)) return "unknown";
        var at = spec!.IndexOf('@');
        var head = at < 0 ? spec : spec.Substring(0, at);
        var id = head.Split('.').Last().ToLowerInvariant();
        var version = at < 0 ? "" : spec.Substring(at + 1).Split('.')[0];
        if (id == "python") return version == "2" ? "ironpython2" : "python3";
        return id.Length > 0 && id != "*" ? id : "unknown";
    }
}
