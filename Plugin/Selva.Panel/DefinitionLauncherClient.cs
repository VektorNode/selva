using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eto.Forms;
using Rhino;
using Rhino.UI;

namespace Selva.RhinoPanel;

/// <summary>What an open is waiting for, in order. Each one blocks the UI thread.</summary>
internal enum OpenStep
{
    LoadingGrasshopper,
    Solving,
    StartingUI
}

/// <summary>
///     The .rhp's half of opening a definition from the panel: loads Grasshopper if it isn't yet,
///     hands the file to the .gha through <see cref="PanelContract.LauncherSlot" />, and keeps
///     what the idle panel shows meanwhile. Owned by the plug-in, because Rhino can recreate the
///     panel. UI thread only.
/// </summary>
internal sealed class DefinitionLauncherClient
{
    private const string RecentKey = "RecentDefinitions";
    private const int MaxRecent = 8;

    // How long an opened definition gets to show its UI before the launcher stops waiting.
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(30);

    private readonly PersistentSettings _settings;
    private UITimer? _startTimer;

    public DefinitionLauncherClient(PersistentSettings settings)
    {
        _settings = settings;
    }

    /// <summary>The idle panel re-reads <see cref="Step" />, <see cref="Error" /> and <see cref="Recent" />.</summary>
    public event Action? Changed;

    /// <summary>Where the open is; null when nothing is opening.</summary>
    public OpenStep? Step { get; private set; }

    /// <summary>The file being opened while <see cref="Step" /> is set.</summary>
    public string? OpeningPath { get; private set; }

    /// <summary>Why the last open failed; null when it didn't.</summary>
    public string? Error { get; private set; }

    /// <summary>Most recent first, only files that still exist.</summary>
    public IReadOnlyList<string> Recent =>
        (_settings.TryGetStringList(RecentKey, out var paths) ? paths : Array.Empty<string>())
        .Where(File.Exists)
        .ToList();

    /// <summary>From the start of an open until its page has loaded or it fails.</summary>
    public bool IsOpening => Step != null;

    /// <summary>Set by the plug-in: true while the panel shows a session rather than the launcher.</summary>
    public Func<bool> IsShowingSession { get; set; } = () => false;

    /// <summary>Set by the plug-in: true while the UI is popped out of the panel.</summary>
    public Func<bool> IsInWindow { get; set; } = () => false;

    public void ShowOpenDialog()
    {
        var dialog = new Eto.Forms.OpenFileDialog { Title = "Open a Grasshopper definition" };
        dialog.Filters.Add(new FileFilter("Grasshopper definitions", ".gh", ".ghx"));
        if (dialog.ShowDialog(RhinoEtoApp.MainWindow) == DialogResult.Ok && !string.IsNullOrEmpty(dialog.FileName))
        {
            Open(dialog.FileName);
        }
    }

    public void Open(string path)
    {
        // Popped out, the panel would only show the in-window label; the new session lands in the window.
        if (!IsInWindow())
        {
            Panels.OpenPanel(typeof(SelvaPanel).GUID);
        }

        Error = null;
        OpeningPath = path;
        SetStep(OpenStep.LoadingGrasshopper);

        var open = FindOpenDelegate(out var unavailable);
        if (open == null)
        {
            Fail(unavailable!);
            return;
        }

        SetStep(OpenStep.Solving);
        string? refusal;
        try
        {
            refusal = open(path);
        }
        catch (Exception ex)
        {
            refusal = $"Could not open {Path.GetFileName(path)}: {ex.Message}";
        }

        if (refusal != null)
        {
            Fail(refusal);
            return;
        }

        RememberRecent(path);

        // Armed first: painting the step runs the .gha's queued show, which can end the wait.
        WaitForSession();
        SetStep(OpenStep.StartingUI);
    }

    /// <summary>A session's page has loaded: whatever the launcher was waiting for is done.</summary>
    public void SessionShown()
    {
        StopWaiting();
        if (Step != null || Error != null)
        {
            Step = null;
            Error = null;
            Changed?.Invoke();
        }
    }

    /// <summary>A player session failed after the .gha took the file.</summary>
    public void Notify(string message)
    {
        Fail(message);
    }

    private static Func<string, string?>? FindOpenDelegate(out string? unavailable)
    {
        unavailable = null;
        if (!(AppDomain.CurrentDomain.GetData(PanelContract.LauncherSlot) is IDictionary<string, object>))
        {
            LoadGrasshopper();
        }

        // LoadEditor is synchronous: if Selva's .gha loaded, it filled the slot by now.
        if (!(AppDomain.CurrentDomain.GetData(PanelContract.LauncherSlot) is IDictionary<string, object> contract))
        {
            unavailable = "Selva's Grasshopper plug-in didn't load. Reinstall Selva from the package manager.";
            return null;
        }

        if (!contract.TryGetValue(PanelContract.VersionKey, out var version) ||
            !(version is int v) || v != PanelContract.Version ||
            !contract.TryGetValue(PanelContract.OpenDefinitionKey, out var openValue) ||
            !(openValue is Func<string, string?> open))
        {
            unavailable = "Selva.Panel.rhp and Selva.gha come from different Selva versions. Reinstall Selva " +
                          "from the package manager.";
            return null;
        }

        return open;
    }

    /// <summary>
    ///     By reflection: this plug-in references RhinoCommon only, so it can load before
    ///     Grasshopper does. Loading shows the editor on Mac, and a player never sees it, so it's
    ///     hidden again straight away.
    /// </summary>
    private static void LoadGrasshopper()
    {
        var grasshopper = RhinoApp.GetPlugInObject("Grasshopper");
        if (grasshopper == null)
        {
            return;
        }

        var type = grasshopper.GetType();
        if (type.GetMethod("IsEditorLoaded", Type.EmptyTypes)?.Invoke(grasshopper, null) is true)
        {
            return;
        }

        type.GetMethod("LoadEditor", Type.EmptyTypes)?.Invoke(grasshopper, null);
        type.GetMethod("HideEditor", Type.EmptyTypes)?.Invoke(grasshopper, null);
    }

    private void WaitForSession()
    {
        StopWaiting();
        _startTimer = new UITimer { Interval = StartTimeout.TotalSeconds };
        _startTimer.Elapsed += (_, _) =>
            Fail("The definition opened, but its Selva UI didn't start. Open it in Grasshopper to see why.");
        _startTimer.Start();
    }

    private void StopWaiting()
    {
        _startTimer?.Stop();
        _startTimer?.Dispose();
        _startTimer = null;
    }

    private void Fail(string message)
    {
        StopWaiting();
        Step = null;

        // A session is still showing, so the launcher isn't on screen.
        if (IsShowingSession())
        {
            Dialogs.ShowMessage(message, "Selva");
            Changed?.Invoke();
            return;
        }

        Error = message;
        Changed?.Invoke();
    }

    /// <summary>Paints before returning: every step blocks the UI thread for up to seconds.</summary>
    private void SetStep(OpenStep step)
    {
        Step = step;
        Changed?.Invoke();
        Application.Instance.RunIteration();
    }

    private void RememberRecent(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var recent = new List<string> { fullPath };
        recent.AddRange(Recent.Where(p => !string.Equals(p, fullPath, StringComparison.OrdinalIgnoreCase)));
        _settings.SetStringList(RecentKey, recent.Take(MaxRecent).ToArray());
    }
}
