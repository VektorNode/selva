using System;
using System.Runtime.InteropServices;
using Eto.Drawing;
using Eto.Forms;
using Rhino.Runtime;
using Rhino.UI;

namespace Selva.RhinoPanel;

/// <summary>Displays the <see cref="SelvaWebHost" />'s WebView while the UI is docked.</summary>
[Guid("60D1852B-C3CD-40CD-A50D-BD0B1DE4F35A")]
public class SelvaPanel : Eto.Forms.Panel
{
    // Rhino for Mac first floats a panel at 200×200, too small for the UI. A floating window
    // narrower than this is taken as that default and grown.
    private const int DefaultFloatWidth = 220;
    private static readonly Size FirstFloatSize = new Size(460, 780);

    private readonly Label _idleLabel = CenteredLabel("Enable a UI Bridge, or right-click one and choose Open UI.");
    private readonly Label _inWindowLabel = CenteredLabel("The Selva UI is in its own window. Close that window to bring it back here.");

    public SelvaPanel()
    {
        Padding = new Padding(0);
        var host = SelvaPanelPlugIn.Instance?.Host;
        if (host != null)
        {
            host.Changed += ShowHostState;
        }

        ShowHostState();
    }

    private void ShowHostState()
    {
        var host = SelvaPanelPlugIn.Instance?.Host;
        if (host?.View == null)
        {
            Content = _idleLabel;
        }
        else if (host.InWindow)
        {
            Content = _inWindowLabel;
        }
        else
        {
            Content = host.View;
        }
    }

    private static Label CenteredLabel(string text)
    {
        return new Label
        {
            Text = text,
            TextAlignment = TextAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Wrap = WrapMode.Word
        };
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
        var host = SelvaPanelPlugIn.Instance?.Host;
        if (disposing && host != null)
        {
            host.Changed -= ShowHostState;
            // Rhino may dispose a panel at any time; the WebView belongs to the host, not to it.
            if (Content == host.View)
            {
                Content = null;
            }
        }

        base.Dispose(disposing);
    }
}
