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

    private readonly Label _inWindowLabel = CenteredLabel("The Selva UI is in its own window. Close that window to bring it back here.");

    public SelvaPanel()
    {
        Padding = new Padding(0);
        var plugIn = SelvaPanelPlugIn.Instance;
        if (plugIn != null)
        {
            plugIn.Host.Changed += ShowHostState;
            plugIn.Launcher.Changed += ShowHostState;
        }

        ShowHostState();
    }

    private void ShowHostState()
    {
        var plugIn = SelvaPanelPlugIn.Instance;
        var host = plugIn?.Host;
        if (host?.View == null)
        {
            Content = plugIn == null ? null : LauncherView(plugIn.Launcher);
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

    /// <summary>
    ///     The idle panel. Native, so an idle panel starts no browser process, and nothing loads
    ///     Grasshopper until the user picks a file.
    /// </summary>
    private static Control LauncherView(DefinitionLauncherClient launcher)
    {
        var busy = launcher.Status != null;
        var layout = new StackLayout
        {
            Padding = new Padding(16),
            Spacing = 10,
            HorizontalContentAlignment = HorizontalAlignment.Stretch
        };

        layout.Items.Add(WrappedLabel("Open a Grasshopper definition to use its Selva UI."));

        var open = new Button { Text = "Open…", Enabled = !busy };
        open.Click += (_, _) => launcher.ShowOpenDialog();
        layout.Items.Add(new StackLayoutItem(open, HorizontalAlignment.Left));

        if (launcher.Status != null)
        {
            layout.Items.Add(WrappedLabel(launcher.Status));
        }

        if (launcher.Error != null)
        {
            layout.Items.Add(WrappedLabel(launcher.Error, Colors.IndianRed));
        }

        var recent = launcher.Recent;
        if (recent.Count > 0)
        {
            layout.Items.Add(new Label { Text = "Recent", Font = SystemFonts.Bold() });
            foreach (var path in recent)
            {
                var link = new LinkButton { Text = System.IO.Path.GetFileName(path), ToolTip = path, Enabled = !busy };
                link.Click += (_, _) => launcher.Open(path);
                layout.Items.Add(new StackLayoutItem(link, HorizontalAlignment.Left));
            }
        }

        layout.Items.Add(new StackLayoutItem(null, true));
        layout.Items.Add(WrappedLabel("To build a UI, enable a UI Bridge in Grasshopper.", SystemColors.DisabledText));

        return new Scrollable { Content = layout, Border = BorderType.None };
    }

    private static Label WrappedLabel(string text, Color? color = null)
    {
        var label = new Label { Text = text, Wrap = WrapMode.Word };
        if (color is Color c)
        {
            label.TextColor = c;
        }

        return label;
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
        var plugIn = SelvaPanelPlugIn.Instance;
        var host = plugIn?.Host;
        if (disposing && host != null)
        {
            host.Changed -= ShowHostState;
            plugIn!.Launcher.Changed -= ShowHostState;
            // Rhino may dispose a panel at any time; the WebView belongs to the host, not to it.
            if (Content == host.View)
            {
                Content = null;
            }
        }

        base.Dispose(disposing);
    }
}
