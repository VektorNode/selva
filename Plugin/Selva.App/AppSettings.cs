using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

namespace Selva.App;

/// <summary>What the app remembers between runs: recent files and where its window was.</summary>
internal sealed class AppSettings
{
    private const int MaxRecent = 8;

    private static readonly string FilePath = Path.Combine(DataFolder, "settings.json");

    /// <summary>Per user and per machine: the WebView's profile lives here too.</summary>
    public static string DataFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Selva", "App");

    public List<string> Recent { get; set; } = new List<string>();

    /// <summary>X, Y, width, height of the restored window; empty before the first run.</summary>
    public int[] Bounds { get; set; } = Array.Empty<int>();

    public bool Maximized { get; set; }

    /// <summary>Most recent first, only files that still exist.</summary>
    public IReadOnlyList<string> ExistingRecent => Recent.Where(File.Exists).ToList();

    public Rectangle? WindowBounds =>
        Bounds.Length == 4 && Bounds[2] > 200 && Bounds[3] > 200
            ? new Rectangle(Bounds[0], Bounds[1], Bounds[2], Bounds[3])
            : (Rectangle?)null;

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                return new JavaScriptSerializer().Deserialize<AppSettings>(File.ReadAllText(FilePath))
                       ?? new AppSettings();
            }
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException ||
                                   ex is ArgumentException || ex is InvalidOperationException)
        {
            // Unreadable settings are only a lost recent list.
        }

        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(DataFolder);
            File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            {
                ["Recent"] = Recent,
                ["Bounds"] = Bounds,
                ["Maximized"] = Maximized
            }));
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            // Nothing to do about a profile that can't be written.
        }
    }

    public void RememberRecent(string path)
    {
        var fullPath = Path.GetFullPath(path);
        Recent = new[] { fullPath }
            .Concat(Recent.Where(p => !string.Equals(p, fullPath, StringComparison.OrdinalIgnoreCase)))
            .Take(MaxRecent)
            .ToList();
        Save();
    }
}
