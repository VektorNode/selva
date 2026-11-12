using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Eto.Drawing;
using Eto.Forms;
using Rhino.Runtime;
using Rhino.UI;

namespace Selva.RhinoPanel;

/// <summary>
///     Displays the <see cref="SelvaWebHost" />'s WebView while the UI is docked.
/// </summary>
/// <remarks>
///     Rhino makes one instance per dock bar the panel sits in, so Selva can be in the sidebar and
///     in a floating container at once. Only one instance, the presenter, holds the WebView: an Eto
///     control has one parent, and two instances taking turns leave one of them blank. The
///     presenter is the instance shown last; the others say where Selva is and can take it.
/// </remarks>
[Guid("60D1852B-C3CD-40CD-A50D-BD0B1DE4F35A")]
public class SelvaPanel : Eto.Forms.Panel, IPanel
{
    // Rhino for Mac first floats a panel at 200×200, too small for the UI. A floating window
    // narrower than this is taken as that default and grown.
    private const int DefaultFloatWidth = 220;
    private static readonly Size FirstFloatSize = new Size(460, 780);

    // Oldest shown first: the last visible one takes over when the presenter goes.
    private static readonly List<SelvaPanel> Instances = new List<SelvaPanel>();
    private static SelvaPanel? _presenter;

    private bool _visible;

    public SelvaPanel()
    {
        Padding = new Padding(0);
        Instances.Add(this);
        // Rhino creates an instance when the panel lands somewhere new, which is where the user
        // is looking. PanelShown corrects this if it's created hidden.
        Present(this);
    }

    /// <summary>Re-reads the host's state into every instance. The plug-in calls it on any change.</summary>
    internal static void RenderAll()
    {
        // The presenter last, so the WebView leaves its old holder before the new one takes it.
        foreach (var panel in Instances.ToArray())
        {
            if (panel != _presenter)
            {
                panel.Render();
            }
        }

        _presenter?.Render();
    }

    private static void Present(SelvaPanel? panel)
    {
        _presenter = panel;
        RenderAll();
    }

    /// <summary>The instance to hand over to when <paramref name="leaving" /> stops showing.</summary>
    private static SelvaPanel? Successor(SelvaPanel leaving)
    {
        var others = Instances.Where(p => p != leaving).ToList();
        return others.LastOrDefault(p => p._visible) ?? others.LastOrDefault();
    }

    private void Render()
    {
        var plugIn = SelvaPanelPlugIn.Instance;

        // An Eto control has one parent: the launcher lets go of the WebView before anything else
        // takes it.
        (Content as LauncherView)?.ReleasePage();

        if (plugIn == null)
        {
            Content = null;
            return;
        }

        var host = plugIn.Host;
        if (host.InWindow)
        {
            Content = Elsewhere("The Selva UI is in its own window.", "Bring it back here", () =>
            {
                _presenter = this;
                host.CloseWindow();
            });
        }
        else if (this != _presenter)
        {
            Content = Elsewhere("Selva is open in another panel.", "Show it here", () => Present(this));
        }
        else if (host.View == null)
        {
            Content = new LauncherView(plugIn.Launcher);
        }
        else if (plugIn.Launcher.IsOpening)
        {
            // The launcher's progress stays up until the page has loaded: the WebView is blank
            // before that.
            Content = new LauncherView(plugIn.Launcher, host.View);
        }
        else
        {
            Content = host.View;
            // Eto.Wpf sizes a reparented control before marking it loaded, so the WebView coming
            // out of the launcher's strip keeps a fixed 100×100 and sits centred. WPF sends no
            // second Loaded to correct it: removed and re-added in one pass. Resetting the size
            // now, once loaded, lets it stretch.
            host.View.Size = new Size(-1, -1);
        }
    }

    private static Control Elsewhere(string text, string action, Action onAction)
    {
        var button = new Button { Text = action };
        button.Click += (_, _) => onAction();
        return new StackLayout
        {
            Padding = new Padding(16),
            Spacing = 12,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            Items =
            {
                new StackLayoutItem(null, true),
                new Label { Text = text, TextAlignment = TextAlignment.Center, Wrap = WrapMode.Word },
                button,
                new StackLayoutItem(null, true)
            }
        };
    }

    void IPanel.PanelShown(uint documentSerialNumber, ShowPanelReason reason)
    {
        _visible = true;
        // Not ShowOnDeactivate: Rhino re-shows floating panels whenever it is reactivated, and
        // that must not pull the page out of the panel the user left it in.
        if (reason == ShowPanelReason.Show)
        {
            Instances.Remove(this);
            Instances.Add(this);
            if (_presenter != this)
            {
                Present(this);
            }
        }
    }

    void IPanel.PanelHidden(uint documentSerialNumber, ShowPanelReason reason)
    {
        // HideOnDeactivate: back as it was when Rhino is active again.
        if (reason == ShowPanelReason.Hide)
        {
            StopShowing();
        }
    }

    void IPanel.PanelClosing(uint documentSerialNumber, bool onCloseDocument)
    {
        StopShowing();
    }

    private void StopShowing()
    {
        _visible = false;
        if (_presenter == this && Successor(this) is { _visible: true } next)
        {
            Present(next);
        }
    }

    protected override void OnLoadComplete(EventArgs e)
    {
        base.OnLoadComplete(e);
        if (HostUtils.RunningOnOSX)
        {
            // Async: Rhino places the floating window after the panel has loaded.
            Application.Instance.AsyncInvoke(GrowDefaultFloatingWindow);
        }
    }

    private void GrowDefaultFloatingWindow()
    {
        if (!(ParentWindow is FloatingForm window) || window.Width >= DefaultFloatWidth)
        {
            return;
        }

        window.Size = FirstFloatSize;
        var main = RhinoEtoApp.MainWindow;
        if (main != null)
        {
            window.Location = new Point(main.Bounds.Right - FirstFloatSize.Width - 24, main.Bounds.Top + 80);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            // Rhino may dispose a panel at any time; the WebView belongs to the host, not to it.
            (Content as LauncherView)?.ReleasePage();
            if (Content != null && Content == SelvaPanelPlugIn.Instance?.Host.View)
            {
                Content = null;
            }

            Instances.Remove(this);
            if (_presenter == this)
            {
                Present(Successor(this));
            }
        }

        base.Dispose(disposing);
    }
}
