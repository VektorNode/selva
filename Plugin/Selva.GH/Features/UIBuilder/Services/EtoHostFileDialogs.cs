#nullable enable
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eto.Forms;
using RhinoEtoApp = Rhino.UI.RhinoEtoApp;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Eto dialogs parented to Rhino's main window, which hosts the panel. No "All files" filter:
///     with no filter at all the dialog already shows every file, and that's what an empty extension
///     list asks for.
/// </summary>
internal sealed class EtoHostFileDialogs : IHostFileDialogs
{
    public string? AskSavePath(string suggestedName)
    {
        using var dialog = new SaveFileDialog { FileName = suggestedName };
        var extension = Path.GetExtension(suggestedName);
        if (extension.Length > 1)
        {
            dialog.Filters.Add(new FileFilter(extension.Substring(1).ToUpperInvariant() + " file", extension));
        }

        return dialog.ShowDialog(RhinoEtoApp.MainWindow) == DialogResult.Ok ? dialog.FileName : null;
    }

    public string? AskOpenPath(IReadOnlyList<string> extensions)
    {
        using var dialog = new OpenFileDialog { MultiSelect = false };
        if (extensions.Count > 0)
        {
            dialog.Filters.Add(new FileFilter("Accepted files", extensions.Select(e => "." + e).ToArray()));
        }

        return dialog.ShowDialog(RhinoEtoApp.MainWindow) == DialogResult.Ok ? dialog.FileName : null;
    }
}
