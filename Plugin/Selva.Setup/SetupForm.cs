#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Selva.App;

namespace Selva.Setup;

/// <summary>
///     The installer's one window: what will happen, a button, then how it went. Drawn with the
///     web UI's surfaces and radii, in Windows' light or dark setting, so it reads as Selva.
/// </summary>
internal sealed class SetupForm : Form
{
    private enum RowState
    {
        Pending,
        Working,
        Done
    }

    private readonly bool _uninstall;
    private readonly string? _version = Installation.PayloadVersion();
    private readonly List<RhinoInstall> _targets = Installation.Targets();
    private readonly Palette _palette = WindowsTheme.IsDark() ? Palette.Dark : Palette.Light;

    private readonly Label _title = new Label();
    private readonly Label _subtitle = new Label();
    private readonly Label _message = new Label();
    private readonly Label _note = new Label();
    private readonly Panel _card = new BufferedPanel();
    private readonly ProgressBar _progress = new ProgressBar();
    private readonly RoundedButton _primary;
    private readonly RoundedButton _secondary;

    private static readonly TimeSpan InputDelay = TimeSpan.FromMilliseconds(600);
    private readonly Stopwatch _shown = new Stopwatch();

    private RowState _rowState;
    private bool _busy;
    private Action? _onPrimary;

    public SetupForm(bool uninstall)
    {
        _uninstall = uninstall;
        _primary = new RoundedButton(_palette, true);
        _secondary = new RoundedButton(_palette, false);

        Text = uninstall ? "Remove Selva" : "Selva Setup";
        Icon = AppIcon.Load();
        Font = new Font("Segoe UI", 9.75f);
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96f, 96f);
        BackColor = _palette.Canvas;
        ForeColor = _palette.Text;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 376);

        var logo = new PictureBox
        {
            Image = AppIcon.Logo(LogicalToDeviceUnits(44)),
            SizeMode = PictureBoxSizeMode.Zoom,
            Bounds = new Rectangle(32, 30, 44, 44)
        };

        _title.Font = new Font("Segoe UI Semibold", 16f);
        _title.Bounds = new Rectangle(29, 88, 402, 34);

        _subtitle.ForeColor = _palette.Muted;
        _subtitle.Bounds = new Rectangle(32, 124, 396, 22);

        // The card lists each Rhino; a state with nothing to list shows the message in its place.
        _card.Bounds = new Rectangle(32, 160, 396, Math.Max(1, _targets.Count) * RowHeight);
        _card.Paint += PaintCard;

        _message.ForeColor = _palette.Muted;
        _message.Bounds = new Rectangle(32, 160, 396, 120);

        _note.ForeColor = _palette.Muted;
        _note.Font = new Font("Segoe UI", 9f);
        _note.Bounds = new Rectangle(32, _card.Bottom + 12, 396, 40);

        _progress.Style = ProgressBarStyle.Marquee;
        _progress.MarqueeAnimationSpeed = 25;
        _progress.Bounds = new Rectangle(32, 300, 396, 4);
        _progress.Visible = false;

        _primary.Bounds = new Rectangle(214, 314, 116, 34);
        _secondary.Bounds = new Rectangle(338, 314, 90, 34);
        _primary.Click += (_, _) =>
        {
            // A window that has only just appeared can take a click or an Enter meant for
            // whatever was under it, and this button installs or removes software.
            if (_shown.IsRunning && _shown.Elapsed >= InputDelay)
            {
                _onPrimary?.Invoke();
            }
        };
        _secondary.Click += (_, _) => Close();

        Controls.AddRange(new Control[]
        {
            logo, _title, _subtitle, _card, _message, _note, _progress, _primary, _secondary
        });
        // Enter installs, but never removes: there it falls on Cancel.
        AcceptButton = uninstall ? _secondary : _primary;
        CancelButton = _secondary;

        if (uninstall)
        {
            ShowMessage("Remove Selva?", null,
                "This removes Selva from Rhino and from this computer. Your definitions and app files stay where they are.",
                "Remove", Run);
        }
        else if (_version == null)
        {
            ShowMessage("This installer is incomplete", null,
                "It carries no Selva to install. Download it again.", null, null);
        }
        else if (_targets.Count == 0)
        {
            ShowMessage("Rhino isn't installed", null,
                "Selva runs inside Rhino 8 or Rhino 9, and neither is on this computer. Install Rhino, then run this setup again.",
                null, null);
        }
        else
        {
            ShowRows("Install Selva", RowState.Pending,
                "For your Windows account only. No administrator rights needed.", "Install", Run);
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        _shown.Start();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (_palette == Palette.Dark)
        {
            WindowsTheme.UseDarkTitleBar(Handle);
        }
    }

    private async void Run()
    {
        if (Installation.RhinoIsRunning())
        {
            ShowMessage("Close Rhino and Selva first", null,
                "Rhino or the Selva app is running and holds Selva's files. Close them, then continue.",
                "Continue", Run);
            return;
        }

        if (_uninstall)
        {
            ShowMessage("Removing Selva…", null, "This takes a few seconds.", null, null, true);
        }
        else
        {
            ShowRows("Installing Selva…", RowState.Working, "", null, null, true);
        }

        try
        {
            await Task.Run(() =>
            {
                if (_uninstall)
                {
                    Installation.Uninstall();
                }
                else
                {
                    Installation.Install(_version!, _targets);
                }
            });
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException ||
                                   ex is System.Security.SecurityException)
        {
            ShowMessage(_uninstall ? "Selva couldn't be removed" : "Selva couldn't be installed", null,
                $"{ex.Message} Close Rhino and the Selva app if they are running, then try again.",
                "Try again", Run);
            return;
        }

        if (_uninstall)
        {
            ShowMessage("Selva was removed", null, "You can close this window.", null, null);
            return;
        }

        ShowRows("Selva is installed", RowState.Done,
            "Double-click a Selva app file to open it, or start Selva from the Start menu.",
            "Open Selva", OpenApp);
    }

    private void OpenApp()
    {
        var exe = Installation.AppExe();
        if (exe != null)
        {
            Process.Start(new ProcessStartInfo { FileName = exe, UseShellExecute = true })?.Dispose();
        }

        Close();
    }

    private void ShowRows(string title, RowState state, string note, string? primary, Action? onPrimary,
        bool busy = false)
    {
        _rowState = state;
        _card.Visible = true;
        _message.Visible = false;
        _note.Text = note;
        _note.Visible = true;
        _card.Invalidate();
        ShowCommon(title, _version == null ? null : $"Version {_version}", primary, onPrimary, busy);
        if (state == RowState.Done)
        {
            // Nothing is left to cancel.
            _secondary.Text = "Close";
        }
    }

    private void ShowMessage(string title, string? subtitle, string message, string? primary, Action? onPrimary,
        bool busy = false)
    {
        _card.Visible = false;
        _note.Visible = false;
        _message.Text = message;
        _message.Visible = true;

        // Without a subtitle the message moves up into its place.
        _message.Top = subtitle == null ? _subtitle.Top : _card.Top;
        ShowCommon(title, subtitle, primary, onPrimary, busy);
    }

    /// <param name="primary">Null leaves only Close.</param>
    private void ShowCommon(string title, string? subtitle, string? primary, Action? onPrimary, bool busy)
    {
        _busy = busy;
        _title.Text = title;
        _subtitle.Text = subtitle ?? "";
        _subtitle.Visible = subtitle != null;
        _progress.Visible = busy;
        _onPrimary = onPrimary;
        _primary.Text = primary ?? "";
        _primary.Visible = primary != null && !busy;
        _secondary.Text = primary == null ? "Close" : "Cancel";
        _secondary.Visible = !busy;
        ControlBox = !busy;
    }

    // ============================================================================
    // The card
    // ============================================================================

    private const int RowHeight = 46;
    private const int CardRadius = 10;

    private void PaintCard(object? sender, PaintEventArgs e)
    {
        var scale = DeviceDpi / 96f;
        var graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        var bounds = new RectangleF(0.5f, 0.5f, _card.Width - 1, _card.Height - 1);
        using (var outline = RoundedButton.RoundedPath(bounds, CardRadius * scale))
        using (var fill = new SolidBrush(_palette.Card))
        using (var border = new Pen(_palette.Border))
        {
            graphics.FillPath(fill, outline);
            graphics.DrawPath(border, outline);
        }

        var rowHeight = _card.Height / (float)Math.Max(1, _targets.Count);
        var inset = (int)(16 * scale);
        var status = _rowState == RowState.Done ? "Installed" :
            _rowState == RowState.Working ? "Installing…" : "Ready to install";
        var statusColor = _rowState == RowState.Done ? _palette.Success : _palette.Muted;
        using var nameFont = new Font("Segoe UI Semibold", 9.75f);

        for (var i = 0; i < _targets.Count; i++)
        {
            var top = (int)(i * rowHeight);
            var row = new Rectangle(inset, top, _card.Width - inset * 2, (int)rowHeight);
            if (i > 0)
            {
                using var separator = new Pen(_palette.Border);
                graphics.DrawLine(separator, 1, top, _card.Width - 2, top);
            }

            TextRenderer.DrawText(graphics, _targets[i].DisplayName, nameFont, row, _palette.Text,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(graphics, status, Font, row, statusColor,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Stopping halfway would leave a package folder half written.
        if (_busy)
        {
            e.Cancel = true;
        }

        base.OnFormClosing(e);
    }

    // ============================================================================
    // Look
    // ============================================================================

    /// <summary>The web UI's surface roles, as sRGB: its stylesheet can't be loaded here.</summary>
    private sealed class Palette
    {
        public static readonly Palette Light = new Palette
        {
            Canvas = Color.FromArgb(250, 250, 250),
            Card = Color.White,
            Border = Color.FromArgb(232, 232, 232),
            BorderStrong = Color.FromArgb(214, 214, 214),
            Text = Color.FromArgb(10, 10, 10),
            Muted = Color.FromArgb(99, 99, 99),
            Primary = Color.FromArgb(23, 23, 23),
            PrimaryHover = Color.FromArgb(48, 48, 48),
            PrimaryText = Color.FromArgb(250, 250, 250),
            Secondary = Color.FromArgb(245, 245, 245),
            SecondaryHover = Color.FromArgb(232, 232, 232),
            Success = Color.FromArgb(21, 128, 61),
            Ring = Color.FromArgb(161, 161, 161)
        };

        public static readonly Palette Dark = new Palette
        {
            Canvas = Color.FromArgb(10, 10, 10),
            Card = Color.FromArgb(23, 23, 23),
            Border = Color.FromArgb(38, 38, 38),
            BorderStrong = Color.FromArgb(58, 58, 58),
            Text = Color.FromArgb(250, 250, 250),
            Muted = Color.FromArgb(161, 161, 161),
            Primary = Color.FromArgb(229, 229, 229),
            PrimaryHover = Color.FromArgb(206, 206, 206),
            PrimaryText = Color.FromArgb(23, 23, 23),
            Secondary = Color.FromArgb(38, 38, 38),
            SecondaryHover = Color.FromArgb(52, 52, 52),
            Success = Color.FromArgb(74, 222, 128),
            Ring = Color.FromArgb(115, 115, 115)
        };

        public Color Canvas { get; private set; }
        public Color Card { get; private set; }
        public Color Border { get; private set; }
        public Color BorderStrong { get; private set; }
        public Color Text { get; private set; }
        public Color Muted { get; private set; }
        public Color Primary { get; private set; }
        public Color PrimaryHover { get; private set; }
        public Color PrimaryText { get; private set; }
        public Color Secondary { get; private set; }
        public Color SecondaryHover { get; private set; }
        public Color Success { get; private set; }
        public Color Ring { get; private set; }
    }

    /// <summary>Repaints without flicker when a row's status changes.</summary>
    private sealed class BufferedPanel : Panel
    {
        public BufferedPanel()
        {
            DoubleBuffered = true;
        }
    }

    /// <summary>A button with the web UI's radius and fills. WinForms' flat style can't round a corner.</summary>
    private sealed class RoundedButton : Button
    {
        private const int Radius = 8;

        private readonly Palette _palette;
        private readonly bool _isPrimary;
        private bool _hover;
        private bool _pressed;

        public RoundedButton(Palette palette, bool isPrimary)
        {
            _palette = palette;
            _isPrimary = isPrimary;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Font = new Font("Segoe UI Semibold", 9.75f);
            Cursor = Cursors.Hand;
        }

        public static GraphicsPath RoundedPath(RectangleF bounds, float radius)
        {
            var diameter = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hover = false;
            _pressed = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs mevent)
        {
            _pressed = true;
            Invalidate();
            base.OnMouseDown(mevent);
        }

        protected override void OnMouseUp(MouseEventArgs mevent)
        {
            _pressed = false;
            Invalidate();
            base.OnMouseUp(mevent);
        }

        protected override void OnPaint(PaintEventArgs pevent)
        {
            var graphics = pevent.Graphics;
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(_palette.Canvas);

            var scale = DeviceDpi / 96f;
            var bounds = new RectangleF(1.5f, 1.5f, Width - 3, Height - 3);
            var lit = (_hover || _pressed) && Enabled;
            var fill = _isPrimary
                ? lit ? _palette.PrimaryHover : _palette.Primary
                : lit ? _palette.SecondaryHover : _palette.Secondary;
            var text = _isPrimary ? _palette.PrimaryText : _palette.Text;
            if (!Enabled)
            {
                fill = _palette.Secondary;
                text = _palette.Muted;
            }

            using (var outline = RoundedPath(bounds, Radius * scale))
            using (var brush = new SolidBrush(fill))
            {
                graphics.FillPath(brush, outline);
                if (!_isPrimary)
                {
                    using var border = new Pen(_palette.BorderStrong);
                    graphics.DrawPath(border, outline);
                }

                // Keyboard focus only: a ring after a mouse click would stay on the button.
                if (Focused && ShowFocusCues)
                {
                    using var ring = new Pen(_palette.Ring, 2f * scale);
                    graphics.DrawPath(ring, outline);
                }
            }

            TextRenderer.DrawText(graphics, Text, Font, ClientRectangle, text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }
}
