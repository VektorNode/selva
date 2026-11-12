using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Selva.AppFormat;
using Selva.AppHost;

namespace Selva.App;

/// <summary>
///     The app's one window. A WebView fills it and shows either the app's own page (launcher,
///     progress, key prompt, errors) or the session page that the plug-in serves from Rhino.
/// </summary>
internal sealed class MainForm : Form
{
    private const string HostCommandScheme = "selva-panel";
    private const string OpenCommand = "open";
    private const string StartingRhino = "StartingRhino";
    private const string LoadingGrasshopper = "LoadingGrasshopper";

    // Rhino's own launcher gives a definition 30 seconds to show its UI after it has loaded
    // Grasshopper and solved once. This is the outer limit for all of that on a cold machine.
    private static readonly TimeSpan OpenTimeout = TimeSpan.FromMinutes(4);

    private static readonly Size FirstSize = new Size(1180, 820);

    private readonly WebView2 _webView = new WebView2 { Dock = DockStyle.Fill };
    private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
    private readonly AppSettings _settings = AppSettings.Load();
    private readonly Timer _openTimer = new Timer();

    /// <summary>Started with a file: the window is that app, and closing the app closes the window.</summary>
    private readonly bool _fixed;

    private readonly bool _dark = WindowsTheme.IsDark();
    private readonly string? _startPath;

    private RhinoHost? _rhino;
    private bool _rhinoReady;
    // The app's page is loaded and takes state; or it was asked for and hasn't said "ready" yet.
    private bool _shellLoaded;
    private bool _shellNavigating;
    private Dictionary<string, object?> _shellState = new Dictionary<string, object?>();
    private Uri? _sessionUrl;

    private string? _path;
    private string? _key;
    private AppFileInfo? _appFile;
    private string _name = "";

    public MainForm(string? startPath)
    {
        _startPath = startPath;
        _fixed = startPath != null;

        Text = "Selva";
        Icon = AppIcon.Load();
        BackColor = _dark ? Color.FromArgb(10, 10, 10) : Color.FromArgb(250, 250, 250);
        MinimumSize = new Size(420, 480);
        PlaceWindow();

        _webView.DefaultBackgroundColor = BackColor;
        Controls.Add(_webView);

        _openTimer.Interval = (int)OpenTimeout.TotalMilliseconds;
        _openTimer.Tick += (_, _) => OnOpenTimedOut();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (_dark)
        {
            WindowsTheme.UseDarkTitleBar(Handle);
        }
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null,
                Path.Combine(AppSettings.DataFolder, "WebView2"));
            await _webView.EnsureCoreWebView2Async(environment);
        }
        catch (Exception ex) when (ex is WebView2RuntimeNotFoundException || ex is System.Runtime.InteropServices.COMException)
        {
            MessageBox.Show(this,
                "Selva needs the Microsoft Edge WebView2 Runtime, which this computer doesn't have. " +
                "Install it from microsoft.com/edge/webview2 and start Selva again.",
                "Selva", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
            return;
        }

        var core = _webView.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.WebMessageReceived += OnShellMessage;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.DownloadStarting += OnDownloadStarting;

        if (_startPath != null)
        {
            Open(_startPath);
        }
        else
        {
            ShowLauncher();
        }
    }

    // ============================================================================
    // Opening
    // ============================================================================

    private void Open(string path)
    {
        _path = Path.GetFullPath(path);
        _key = null;
        _appFile = null;
        _name = Path.GetFileNameWithoutExtension(_path);

        if (!File.Exists(_path))
        {
            ShowError($"{Path.GetFileName(_path)} doesn't exist any more.", false);
            return;
        }

        if (AppFile.HasMagic(_path))
        {
            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(_path);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                ShowError($"{Path.GetFileName(_path)} couldn't be read: {ex.Message}", true);
                return;
            }

            var refusal = AppFile.TryRead(bytes, out var info);
            if (refusal != null)
            {
                ShowError(refusal, false);
                return;
            }

            // Only what the key prompt and the title need; the definition stays on disk.
            info.Body = Array.Empty<byte>();
            _appFile = info;
            _name = info.Name;
            ApplyAppIcon(info.IconPng);

            if (info.Encrypted)
            {
                _key = KeyStore.Read(info.KeyId);
                if (_key == null)
                {
                    Text = _name;
                    SetShell("key", ("name", _name), ("error", null));
                    return;
                }
            }
        }

        Text = _fixed ? _name : $"{_name} - Selva";
        StartOpen();
    }

    private async void OnKeyEntered(string key, bool remember)
    {
        var appFile = _appFile;
        if (appFile == null)
        {
            return;
        }

        // The id is a slow hash by design, so it's worked out off the UI thread.
        var id = await Task.Run(() => AppFileKey.Hex(AppFileKey.IdOf(key)));
        if (appFile != _appFile)
        {
            return;
        }

        if (id != appFile.KeyId)
        {
            SetShell("key", ("name", _name), ("error", "That key doesn't open this app."));
            return;
        }

        if (remember)
        {
            KeyStore.Write(appFile.KeyId, key);
        }

        _key = key;
        StartOpen();
    }

    private void StartOpen()
    {
        _openTimer.Stop();
        _openTimer.Start();

        if (_rhino == null)
        {
            _rhinoReady = false;
            _rhino = new RhinoHost();
            _rhino.Message += OnRhinoMessage;
            _rhino.Failed += OnRhinoFailed;
            _rhino.Start();
        }

        if (_rhinoReady)
        {
            SendOpen();
        }
        else
        {
            SetShell("opening", ("name", _name), ("step", StartingRhino));
        }
    }

    private void SendOpen()
    {
        SetShell("opening", ("name", _name), ("step", LoadingGrasshopper));
        _rhino!.Send(AppHostProtocol.Open,
            new KeyValuePair<string, string?>(AppHostProtocol.PathField, _path),
            new KeyValuePair<string, string?>(AppHostProtocol.KeyField, _key));
    }

    private void OnRhinoMessage(IDictionary<string, string?> message)
    {
        message.TryGetValue(AppHostProtocol.TypeField, out var type);
        switch (type)
        {
            case AppHostProtocol.Ready:
                _rhinoReady = true;
                if (_openTimer.Enabled)
                {
                    SendOpen();
                }

                break;

            case AppHostProtocol.Step:
                if (message.TryGetValue(AppHostProtocol.StepField, out var step) && _sessionUrl == null)
                {
                    SetShell("opening", ("name", _name), ("step", step));
                }

                break;

            case AppHostProtocol.Show:
                if (message.TryGetValue(AppHostProtocol.UrlField, out var url) &&
                    Uri.TryCreate(url, UriKind.Absolute, out var sessionUrl))
                {
                    ShowSession(sessionUrl);
                }

                break;

            case AppHostProtocol.Clear:
                // The definition closed from inside its page.
                if (_fixed)
                {
                    Close();
                }
                else
                {
                    Text = "Selva";
                    ShowLauncher();
                }

                break;

            case AppHostProtocol.Error:
                message.TryGetValue(AppHostProtocol.MessageField, out var error);
                OnOpenFailed(error ?? "The app didn't open.");
                break;
        }
    }

    private void ShowSession(Uri url)
    {
        _openTimer.Stop();
        _sessionUrl = url;
        _shellLoaded = false;
        _shellNavigating = false;
        if (_path != null)
        {
            _settings.RememberRecent(_path);
        }

        _webView.CoreWebView2.Navigate(url.AbsoluteUri);
    }

    private void OnOpenFailed(string message)
    {
        _openTimer.Stop();
        ShowError(message, true);
    }

    private void OnRhinoFailed(string message)
    {
        _openTimer.Stop();
        _rhino = null;
        _rhinoReady = false;
        ShowError(message, _path != null);
    }

    /// <summary>
    ///     Rhino went quiet: most likely a dialog opened where nobody can see it. That Rhino is
    ///     no use any more, so the next attempt starts a new one.
    /// </summary>
    private void OnOpenTimedOut()
    {
        _openTimer.Stop();
        var rhino = _rhino;
        _rhino = null;
        _rhinoReady = false;
        if (rhino != null)
        {
            rhino.Message -= OnRhinoMessage;
            rhino.Failed -= OnRhinoFailed;
            Task.Run(rhino.Quit);
        }

        ShowError("The app took too long to start. Open the definition in Grasshopper to see what it's waiting for.",
            true);
    }

    private void ChooseFile()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Open an app",
            Filter = "Selva apps and Grasshopper definitions|*.slvx;*.gh;*.ghx|All files|*.*"
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            Open(dialog.FileName);
        }
    }

    // ============================================================================
    // The app's own page
    // ============================================================================

    private void ShowLauncher()
    {
        _path = null;
        var recent = _settings.ExistingRecent.Select(path => new Dictionary<string, object?>
        {
            ["path"] = path,
            ["name"] = Path.GetFileNameWithoutExtension(path),
            ["folder"] = Path.GetDirectoryName(path)
        }).ToArray();
        SetShell("launcher", ("recent", recent));
    }

    private void ShowError(string message, bool canRetry)
    {
        SetShell("error", ("message", message), ("canRetry", canRetry));
    }

    /// <summary>The page is stateless: it draws whatever the last call here said.</summary>
    private void SetShell(string view, params (string Key, object? Value)[] fields)
    {
        _shellState = new Dictionary<string, object?> { ["view"] = view, ["fixed"] = _fixed };
        foreach (var (key, value) in fields)
        {
            _shellState[key] = value;
        }

        _sessionUrl = null;
        if (_shellLoaded)
        {
            PushShellState();
        }
        else if (!_shellNavigating)
        {
            // The first paint, or coming back from a session page. The page asks for its state
            // with "ready" once it has loaded.
            _shellNavigating = true;
            _webView.CoreWebView2.NavigateToString(ShellHtml.Value);
        }
    }

    private void PushShellState()
    {
        _ = _webView.CoreWebView2.ExecuteScriptAsync($"window.selvaShell({_json.Serialize(_shellState)})");
    }

    private void OnShellMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // The session page comes from the plug-in's server and has no business driving the app.
        if (_sessionUrl != null)
        {
            return;
        }

        Dictionary<string, object?>? message;
        try
        {
            message = _json.Deserialize<Dictionary<string, object?>>(e.WebMessageAsJson);
        }
        catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException)
        {
            return;
        }

        if (message == null || !message.TryGetValue("cmd", out var command))
        {
            return;
        }

        switch (command as string)
        {
            case "ready":
                _shellLoaded = true;
                _shellNavigating = false;
                PushShellState();
                break;

            case "choose":
                ChooseFile();
                break;

            case "open":
                if (message.TryGetValue("path", out var path) && path is string openPath)
                {
                    Open(openPath);
                }

                break;

            case "key":
                if (message.TryGetValue("key", out var key) && key is string typed && typed.Length > 0)
                {
                    OnKeyEntered(typed, message.TryGetValue("remember", out var remember) && remember is true);
                }

                break;

            case "retry":
                if (_path != null)
                {
                    Open(_path);
                }

                break;

            case "back":
                if (_fixed)
                {
                    Close();
                }
                else
                {
                    Text = "Selva";
                    ShowLauncher();
                }

                break;
        }
    }

    private static readonly Lazy<string> ShellHtml = new Lazy<string>(() =>
    {
        var logo = "data:image/svg+xml;base64," + Convert.ToBase64String(ReadResource("Selva.App.logo.svg"));
        return Encoding.UTF8.GetString(ReadResource("Selva.App.shell.html")).Replace("%LOGO%", logo);
    });

    private static byte[] ReadResource(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
                           ?? throw new InvalidOperationException($"Missing resource {name}.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    // ============================================================================
    // The session page
    // ============================================================================

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target))
        {
            return;
        }

        if (target.Scheme == HostCommandScheme)
        {
            e.Cancel = true;
            if (target.Host == OpenCommand)
            {
                // Not inside the navigation callback: a modal dialog there stalls the WebView.
                BeginInvoke((Action)ChooseFile);
            }

            return;
        }

        if (target.Scheme == "about" || target.Scheme == "data")
        {
            return;
        }

        // The session page stays on the plug-in's server; anything else is a link out.
        var session = _sessionUrl;
        if (session != null && target.Scheme == session.Scheme && target.Host == session.Host &&
            target.Port == session.Port)
        {
            return;
        }

        e.Cancel = true;
        OpenInBrowser(target);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var target))
        {
            OpenInBrowser(target);
        }
    }

    /// <summary>A file the app produced is saved where the user says, as in any desktop program.</summary>
    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var deferral = e.GetDeferral();
        BeginInvoke((Action)(() =>
        {
            try
            {
                var suggested = e.ResultFilePath;
                using var dialog = new SaveFileDialog
                {
                    FileName = Path.GetFileName(suggested),
                    InitialDirectory = Path.GetDirectoryName(suggested),
                    OverwritePrompt = true
                };
                var extension = Path.GetExtension(suggested);
                if (!string.IsNullOrEmpty(extension))
                {
                    dialog.Filter = $"{extension.TrimStart('.').ToUpperInvariant()} file|*{extension}|All files|*.*";
                }

                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    e.ResultFilePath = dialog.FileName;
                    e.Handled = true;
                }
                else
                {
                    e.Cancel = true;
                }
            }
            finally
            {
                deferral.Complete();
            }
        }));
    }

    private static void OpenInBrowser(Uri target)
    {
        if (target.Scheme != Uri.UriSchemeHttp && target.Scheme != Uri.UriSchemeHttps &&
            target.Scheme != Uri.UriSchemeMailto)
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo { FileName = target.AbsoluteUri, UseShellExecute = true });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // No handler for the link.
        }
    }

    // ============================================================================
    // The window
    // ============================================================================

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (e.Cancel)
        {
            return;
        }

        var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        _settings.Bounds = new[] { bounds.X, bounds.Y, bounds.Width, bounds.Height };
        _settings.Maximized = WindowState == FormWindowState.Maximized;
        _settings.Save();

        // Off screen first: waiting for Rhino to exit shouldn't look like a hung window.
        Hide();
        _rhino?.Quit();
    }

    private void PlaceWindow()
    {
        var saved = _settings.WindowBounds;
        if (saved is Rectangle bounds && Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(bounds)))
        {
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
        }
        else
        {
            StartPosition = FormStartPosition.CenterScreen;
            Size = FirstSize;
        }

        if (_settings.Maximized)
        {
            WindowState = FormWindowState.Maximized;
        }
    }

    private void ApplyAppIcon(byte[]? png)
    {
        if (png == null)
        {
            return;
        }

        try
        {
            using var stream = new MemoryStream(png);
            using var bitmap = new Bitmap(stream);
            Icon = Icon.FromHandle(bitmap.GetHicon());
        }
        catch (ArgumentException)
        {
            // Not an image Windows can read; the app keeps Selva's icon.
        }
    }

}
