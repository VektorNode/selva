#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Plugin;
using Rhino;
using Selva.GH.Features.UIBuilder.Components;
using Selva.GH.Utilities.Helpers;
using Selva.RhinoPanel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Opens a definition from the Selva panel as a player session: preview only, Grasshopper's
///     editor stays hidden, nothing is written back to the file. One player document at a time;
///     documents the user opened in Grasshopper are never touched. UI thread only.
/// </summary>
/// <remarks>
///     A player document is the canvas's document, so whenever the editor is on screen the user
///     can edit it. The session hands the document over then, as Edit in Grasshopper does: a
///     player document never asks to be saved, and the edits would be dropped without a word.
/// </remarks>
internal static class DefinitionLauncher
{
    private sealed class PlayerSession
    {
        public PlayerSession(GH_Document document, GH_Document? previous, GH_UIBuilderComponent bridge,
            List<GH_UIBuilderComponent> suppressed)
        {
            Document = document;
            Previous = previous;
            Bridge = bridge;
            Suppressed = suppressed;
        }

        public GH_Document Document { get; }

        /// <summary>The canvas's document before this one: only the canvas's document solves.</summary>
        public GH_Document? Previous { get; }

        public GH_UIBuilderComponent Bridge { get; }

        /// <summary>The document's other bridges, kept off while it's a player document.</summary>
        public List<GH_UIBuilderComponent> Suppressed { get; }
    }

    private static PlayerSession? _current;

    /// <summary>Fills <see cref="PanelContract.LauncherSlot" /> for the .rhp's launcher.</summary>
    public static void Register()
    {
        AppDomain.CurrentDomain.SetData(PanelContract.LauncherSlot, new Dictionary<string, object>
        {
            [PanelContract.VersionKey] = PanelContract.Version,
            [PanelContract.OpenDefinitionKey] = (Func<string, string?>)Open
        });
    }

    /// <returns>Null when the definition opened; otherwise why not, for the user.</returns>
    public static string? Open(string path)
    {
        try
        {
            return OpenCore(path);
        }
        catch (Exception ex)
        {
            // The message may hold the path, so it goes to the user only, never the log.
            Logger.Error($"[DefinitionLauncher] Opening a definition failed: {ex.GetType().Name}");
            return $"Could not open {Path.GetFileName(path)}: {ex.Message}";
        }
    }

    private static string? OpenCore(string path)
    {
        if (!File.Exists(path))
        {
            return $"{Path.GetFileName(path)} doesn't exist any more.";
        }

        // A second copy would carry the same persisted DocumentID as the one already open, and
        // closing it would reach that document's bridge.
        var fullPath = Path.GetFullPath(path);
        if (Instances.DocumentServer.Any(d => d != _current?.Document && IsSameFile(d.FilePath, fullPath)))
        {
            return $"{Path.GetFileName(path)} is already open in Grasshopper. Use its UI Bridge instead.";
        }

        // Read without solving: the document isn't in the document server yet, so nothing runs
        // before the bridges are marked. A file saved with Enable on would otherwise cold-start
        // as an author session.
        var io = new GH_DocumentIO();
        if (!io.Open(fullPath) || io.Document == null)
        {
            return $"Grasshopper couldn't read {Path.GetFileName(path)}.";
        }

        var document = io.Document;
        var bridges = document.Objects.OfType<GH_UIBuilderComponent>().ToList();
        var player = bridges.FirstOrDefault(HasSelvaUI);
        if (player == null)
        {
            return $"{Path.GetFileName(path)} has no Selva UI. Open it in Grasshopper to add one.";
        }

        player.HostAsPlayer();
        var others = bridges.Where(b => b != player).ToList();
        foreach (var other in others)
        {
            other.Suppress();
        }

        // From one player definition to the next, the user's document stays disabled: it gets the
        // canvas back when the last one closes.
        var replaced = _current;
        var canvas = Instances.ActiveCanvas;
        var previous = replaced != null ? replaced.Previous : canvas?.Document;

        // Its servers stop before the canvas switch starts the new bridge's, which would otherwise
        // find the WebSocket port taken.
        replaced?.Bridge.Dispose();

        // Set up before the canvas switch, which solves the document. Grasshopper draws no preview
        // while its editor is hidden, unless it's forced.
        document.ForcePreview(true);
        document.ModifiedChanged += KeepUnmodified;
        _current = new PlayerSession(document, previous, player, others);

        Instances.DocumentServer.AddDocument(document);
        if (canvas != null)
        {
            canvas.Document = document;
        }

        document.Enabled = true;

        // After the switch: removing a document the canvas still shows hands the canvas to
        // whichever document is next, and solves that one.
        if (replaced != null)
        {
            Remove(replaced);
        }

        WatchEditor();
        if (IsEditorVisible())
        {
            EditInGrasshopper();
        }

        document.NewSolution(false);
        return null;
    }

    /// <summary>
    ///     Closes the player definition, if there is one, and gives the canvas back to the
    ///     document it showed before.
    /// </summary>
    public static void Close()
    {
        var session = _current;
        if (session == null)
        {
            return;
        }

        _current = null;
        UnwatchEditor();

        var previous = session.Previous != null && Instances.DocumentServer.Contains(session.Previous)
            ? session.Previous
            : null;
        var canvas = Instances.ActiveCanvas;
        if (canvas != null && canvas.Document == session.Document)
        {
            // The canvas enables and solves the document it's given.
            canvas.Document = previous;
        }
        else if (canvas == null && previous != null)
        {
            previous.Enabled = true;
            previous.NewSolution(false);
        }

        Remove(session);
    }

    /// <summary>
    ///     Removing a document reaches none of the paths that stop a bridge's servers, so the
    ///     bridge is torn down first. The canvas must not be showing the document.
    /// </summary>
    private static void Remove(PlayerSession session)
    {
        session.Document.ModifiedChanged -= KeepUnmodified;
        session.Bridge.Dispose();
        session.Document.ForcePreview(false);
        session.Document.IsModified = false;
        Instances.DocumentServer.RemoveDocument(session.Document);
    }

    /// <summary>
    ///     Shows the editor with the player document and hands it over: from here it's the user's
    ///     document like any other, and the next schema sync marks it modified.
    /// </summary>
    public static void EditInGrasshopper()
    {
        var session = _current;
        if (session == null)
        {
            return;
        }

        _current = null;
        UnwatchEditor();
        session.Document.ModifiedChanged -= KeepUnmodified;
        session.Document.ForcePreview(false);

        if (RhinoApp.GetPlugInObject("Grasshopper") is GH_RhinoScriptInterface grasshopper)
        {
            grasshopper.ShowEditor();
        }

        session.Bridge.BecomeAuthor();
        foreach (var other in session.Suppressed)
        {
            other.ReleaseSuppression();
        }
    }

    /// <summary>
    ///     Selva's post-solve schema sync calls <c>Modified()</c>, and Grasshopper asks to save
    ///     modified documents on close and when Rhino quits. A player document is never saved.
    /// </summary>
    private static void KeepUnmodified(object sender, GH_DocModifiedEventArgs e)
    {
        if (e.Modified && sender is GH_Document document)
        {
            document.IsModified = false;
        }
    }

    private static void WatchEditor()
    {
        if (Instances.DocumentEditor is Control editor)
        {
            editor.VisibleChanged -= HandOverWhenShown;
            editor.VisibleChanged += HandOverWhenShown;
        }
    }

    private static void UnwatchEditor()
    {
        if (Instances.DocumentEditor is Control editor)
        {
            editor.VisibleChanged -= HandOverWhenShown;
        }
    }

    private static void HandOverWhenShown(object? sender, EventArgs e)
    {
        if (IsEditorVisible() && Instances.ActiveCanvas?.Document == _current?.Document)
        {
            EditInGrasshopper();
        }
    }

    private static bool IsEditorVisible()
    {
        return (Instances.DocumentEditor as Control)?.Visible == true;
    }

    /// <summary>The same check the bridge makes before it serves a UI.</summary>
    private static bool HasSelvaUI(GH_UIBuilderComponent bridge)
    {
        return bridge.Schema != null && BridgeOrchestrator.FindWiredContextBake(bridge) != null;
    }

    private static bool IsSameFile(string? candidate, string fullPath)
    {
        if (string.IsNullOrEmpty(candidate))
        {
            return false;
        }

        try
        {
            return string.Equals(Path.GetFullPath(candidate), fullPath, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            return false;
        }
    }
}
