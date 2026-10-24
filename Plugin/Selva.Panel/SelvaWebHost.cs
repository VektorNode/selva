using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Eto.Drawing;
using Eto.Forms;
using Rhino.UI;

namespace Selva.RhinoPanel;

/// <summary>
///     Owns the one WebView the UI runs in and moves it between the docked panel and its own
///     window, so the page and its socket survive the move. The containers only display it. UI
///     thread only.
/// </summary>
internal sealed class SelvaWebHost
{
    private static readonly Uri Blank = new Uri("about:blank");
    private static readonly Size DefaultWindowSize = new Size(1100, 800);

    private PanelTarget? _shown;

    // Created on the first target and kept for the life of the plug-in: an idle panel starts no
    // browser process, and disposing WebView2 mid-initialisation throws E_ABORT on older Eto.
    private WebView? _webView;

    private readonly Action _showOpenDialog;

    private Form? _window;
    private Rectangle? _lastWindowBounds;
    private bool _shuttingDown;

    /// <param name="showOpenDialog">What the page's Open another… link does.</param>
    public SelvaWebHost(Action showOpenDialog)
    {
        _showOpenDialog = showOpenDialog;
    }

    /// <summary>The panel re-reads <see cref="View" /> and <see cref="InWindow" />.</summary>
    public event Action? Changed;

    public PanelTarget? Shown => _shown;

    /// <summary>The WebView to display, or null while there's no session.</summary>
    public WebView? View => _shown == null ? null : _webView;

    public bool InWindow => _window != null;

    public void Show(PanelTarget target)
    {
        _webView ??= CreateWebView();
        if (_shown?.Url != target.Url)
        {
            _webView.Url = target.Url;
        }

        _shown = target;
        Changed?.Invoke();

        if (_window != null)
        {
            _window.BringToFront();
        }
        else
        {
            Panels.OpenPanel(typeof(SelvaPanel).GUID);
        }
    }

    public void Clear()
    {
        if (_webView != null && _shown != null)
        {
            _webView.Url = Blank;
        }

        _shown = null;
        CloseWindow();
        Changed?.Invoke();
    }

    /// <summary>Rhino closes every window when it quits; that close must not re-dock.</summary>
    public void BeginShutdown()
    {
        _shuttingDown = true;
    }

    private void ToggleWindow()
    {
        if (_window != null)
        {
            CloseWindow();
        }
        else if (View != null)
        {
            OpenWindow();
        }
    }

    /// <summary>
    ///     A normal window, unlike Rhino's floating panel window: it gets the full title bar,
    ///     native fullscreen with its own Space on Mac, and can sit on another display.
    /// </summary>
    private void OpenWindow()
    {
        var window = new Form
        {
            Title = "Selva",
            Resizable = true,
            Maximizable = true,
            Minimizable = true,
            Size = DefaultWindowSize
        };
        if (_lastWindowBounds is Rectangle bounds)
        {
            window.Bounds = bounds;
        }

        // The panel must let go of the WebView before the window takes it: an Eto control has
        // one parent.
        _window = window;
        Changed?.Invoke();
        window.Content = _webView;
        window.Closing += (_, _) => OnWindowClosing(window);
        window.Show();
        NotifyPage();
    }

    private void CloseWindow()
    {
        var window = _window;
        if (window == null)
        {
            return;
        }

        window.Close();
    }

    // Closing, not Closed: the WebView has to leave the window before Eto tears the window down.
    private void OnWindowClosing(Form window)
    {
        if (_window != window)
        {
            return;
        }

        _lastWindowBounds = window.Bounds;
        window.Content = null;
        _window = null;
        if (_shuttingDown)
        {
            return;
        }

        Changed?.Invoke();
        Panels.OpenPanel(typeof(SelvaPanel).GUID);
        NotifyPage();
    }

    private WebView CreateWebView()
    {
        var webView = new WebView { BrowserContextMenuEnabled = true };

        webView.DocumentLoading += (_, e) =>
        {
            if (!e.IsMainFrame || _shown == null)
            {
                return;
            }

            var decision = NavigationPolicy.Decide(_shown.Url, e.Uri);
            if (decision == NavigationDecision.Allow)
            {
                return;
            }

            e.Cancel = true;
            if (decision == NavigationDecision.OpenInBrowser)
            {
                OpenInBrowser(e.Uri);
            }
            else if (decision == NavigationDecision.HostCommand)
            {
                // Not inside the navigation callback: moving the WebView, or opening a modal
                // dialog, mid-decision is unsafe.
                if (e.Uri.Host == NavigationPolicy.ToggleWindowCommand)
                {
                    Application.Instance.AsyncInvoke(ToggleWindow);
                }
                else if (e.Uri.Host == NavigationPolicy.OpenCommand)
                {
                    Application.Instance.AsyncInvoke(_showOpenDialog);
                }
            }
        };

        webView.OpenNewWindow += (_, e) =>
        {
            e.Cancel = true;
            if (_shown != null &&
                NavigationPolicy.Decide(_shown.Url, e.Uri) is NavigationDecision.Allow or NavigationDecision.OpenInBrowser)
            {
                OpenInBrowser(e.Uri);
            }
        };

        // A reload forgets what NotifyPage told the previous document.
        webView.DocumentLoaded += (_, _) => NotifyPage();

        EnableWebInspector(webView);
        return webView;
    }

    /// <summary>
    ///     Tells the page whether it is docked or in its own window, so its toggle reads right.
    ///     Async on purpose: the synchronous ExecuteScript pumps the message loop while it waits.
    /// </summary>
    private void NotifyPage()
    {
        if (_webView == null || _shown == null)
        {
            return;
        }

        var container = InWindow ? "window" : "panel";
        var script = $"window.__selvaHostContainer = '{container}';" +
                     $"window.dispatchEvent(new CustomEvent('selva-host-container', {{ detail: '{container}' }}));";
        _ = _webView.ExecuteScriptAsync(script)
            .ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
    }

    /// <summary>
    ///     WKWebView hides Safari's Web Inspector unless <c>Inspectable</c> is set (macOS 13.3+).
    ///     Reflection keeps Microsoft.macOS out of the references; WebView2 has no such property
    ///     and already inspects from the context menu.
    /// </summary>
    private static void EnableWebInspector(WebView webView)
    {
        try
        {
            var native = webView.ControlObject;
            native?.GetType().GetProperty("Inspectable")?.SetValue(native, true);
        }
        catch (Exception)
        {
            // An older WebKit binding without the property: the UI works, uninspectable.
        }
    }

    private static void OpenInBrowser(Uri uri)
    {
        Process.Start(new ProcessStartInfo { FileName = uri.AbsoluteUri, UseShellExecute = true });
    }
}
