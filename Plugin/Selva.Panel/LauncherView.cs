using System;
using System.IO;
using System.Linq;
using Eto.Drawing;
using Eto.Forms;
using Rhino.ApplicationSettings;
using Rhino.Runtime;

namespace Selva.RhinoPanel;

/// <summary>
///     The panel's native page: the launcher while idle, and the open steps while a definition
///     opens and its page loads behind them. Native, so an idle panel starts no browser process,
///     and nothing loads Grasshopper until the user picks a file.
/// </summary>
internal sealed class LauncherView : Scrollable
{
    private const int Gutter = 12;

    private static readonly float BaseSize = SystemFonts.Default().Size;
    private static readonly Font BodyFont = SystemFonts.Default();
    private static readonly Font BoldFont = SystemFonts.Bold();
    private static readonly Font SmallFont = SystemFonts.Default(BaseSize * 0.85f);
    private static readonly Font SmallBoldFont = SystemFonts.Bold(BaseSize * 0.85f);

    private readonly DefinitionLauncherClient _launcher;
    private readonly DropZone? _dropZone;
    private readonly Panel? _pageHolder;

    /// <param name="loadingPage">The WebView whose page loads while the launcher shows progress.</param>
    public LauncherView(DefinitionLauncherClient launcher, Control? loadingPage = null)
    {
        _launcher = launcher;
        Border = BorderType.None;
        AllowDrop = !launcher.IsOpening;

        var layout = new StackLayout
        {
            Padding = new Padding(Gutter),
            HorizontalContentAlignment = HorizontalAlignment.Stretch
        };

        void Space(int height)
        {
            layout.Items.Add(new Panel { Height = height });
        }

        if (launcher.Step is OpenStep current)
        {
            layout.Items.Add(new OpeningHeader(Path.GetFileNameWithoutExtension(launcher.OpeningPath ?? "")));
            Space(16);
            var steps = new StackLayout { HorizontalContentAlignment = HorizontalAlignment.Stretch };
            foreach (OpenStep step in Enum.GetValues(typeof(OpenStep)))
            {
                var (label, stepHint) = Describe(step);
                steps.Items.Add(new StepRow(label, step < current ? StepState.Done
                    : step == current ? StepState.Active : StepState.Pending));
                if (step == current)
                {
                    steps.Items.Add(new StepHint(stepHint));
                }
            }

            layout.Items.Add(new Card(steps, 6));
        }
        else
        {
            _dropZone = new DropZone();
            _dropZone.Click += (_, _) => launcher.ShowOpenDialog();
            layout.Items.Add(_dropZone);

            if (launcher.Error != null)
            {
                Space(12);
                layout.Items.Add(new ErrorBox(launcher.Error));
            }

            var recent = launcher.Recent;
            if (recent.Count > 0)
            {
                Space(22);
                layout.Items.Add(Text("Recent", SmallBoldFont, Dim));
                Space(8);
                var rows = new StackLayout { HorizontalContentAlignment = HorizontalAlignment.Stretch };
                foreach (var path in recent)
                {
                    var row = new RecentRow(path);
                    row.Click += (_, _) => launcher.Open(path);
                    rows.Items.Add(row);
                }

                layout.Items.Add(new Card(rows, 4));
            }
        }

        layout.Items.Add(new StackLayoutItem(null, true));
        Space(16);
        var hint = Text("To build a UI, enable a UI Bridge in Grasshopper.", SmallFont, Dim);
        hint.TextAlignment = TextAlignment.Center;
        layout.Items.Add(hint);

        // A one-pixel strip, not detached: WebView2 only starts inside a visible window.
        if (loadingPage != null)
        {
            _pageHolder = new Panel { Height = 1, Content = loadingPage };
            layout.Items.Add(_pageHolder);
        }

        Content = layout;
    }

    private static Color Fore => Paint(PaintColor.TextEnabled);
    private static Color Dim => Paint(PaintColor.TextDisabled);

    // sRGB copies of --primary, --primary-foreground and --destructive in
    // packages/ui/src/lib/styles/base.css. Eto can't read the CSS, so change both together.
    private static Color Accent => HostUtils.RunningInDarkMode ? Color.FromArgb(152, 181, 137) : Color.FromArgb(87, 114, 73);
    private static Color OnAccent => HostUtils.RunningInDarkMode ? Color.FromArgb(18, 18, 18) : Colors.White;
    private static Color Danger => HostUtils.RunningInDarkMode ? Color.FromArgb(246, 108, 109) : Color.FromArgb(201, 48, 45);

    private static (string label, string hint) Describe(OpenStep step)
    {
        return step switch
        {
            OpenStep.LoadingGrasshopper => ("Load Grasshopper", "Grasshopper loads once per Rhino session."),
            OpenStep.Solving => ("Run the first solve",
                "The definition solves once before its UI opens. Large definitions take longer."),
            _ => ("Start the UI", "Rhino previews the result in the viewport, then the UI loads.")
        };
    }

    public void ReleasePage()
    {
        if (_pageHolder != null)
        {
            _pageHolder.Content = null;
        }
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        FitContent();
    }

    // A docked panel is sized after it loads and may report no size from OnSizeChanged until the
    // user resizes the dock, so the width is also applied once loaded and once shown.
    protected override void OnLoadComplete(EventArgs e)
    {
        base.OnLoadComplete(e);
        FitContent();
        Application.Instance.AsyncInvoke(FitContent);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        FitContent();
    }

    // A Scrollable measures its content at unbounded width, so wrapped labels would never wrap.
    private void FitContent()
    {
        var width = ClientSize.Width > 0 ? ClientSize.Width : Width;
        if (width > 0 && Content != null)
        {
            Content.Width = width;
        }
    }

    protected override void OnDragOver(DragEventArgs e)
    {
        base.OnDragOver(e);
        var accepted = DroppedDefinition(e) != null;
        e.Effects = accepted ? DragEffects.Copy : DragEffects.None;
        if (_dropZone != null)
        {
            _dropZone.DragActive = accepted;
        }
    }

    protected override void OnDragLeave(DragEventArgs e)
    {
        base.OnDragLeave(e);
        if (_dropZone != null)
        {
            _dropZone.DragActive = false;
        }
    }

    protected override void OnDragDrop(DragEventArgs e)
    {
        base.OnDragDrop(e);
        if (_dropZone != null)
        {
            _dropZone.DragActive = false;
        }

        var path = DroppedDefinition(e);
        if (path != null)
        {
            // Open blocks for seconds and rebuilds this view; run inside the drop callback, it would
            // also hold the Finder drag until it returns.
            Application.Instance.AsyncInvoke(() => _launcher.Open(path));
        }
    }

    private static string? DroppedDefinition(DragEventArgs e)
    {
        if (!e.Data.ContainsUris)
        {
            return null;
        }

        return e.Data.Uris
            .Where(uri => uri.IsFile)
            .Select(uri => uri.LocalPath)
            .FirstOrDefault(path =>
                string.Equals(Path.GetExtension(path), ".gh", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(Path.GetExtension(path), ".ghx", StringComparison.OrdinalIgnoreCase));
    }

    private static Color Paint(PaintColor color)
    {
        var c = AppearanceSettings.GetPaintColor(color);
        return Color.FromArgb(c.R, c.G, c.B, c.A);
    }

    /// <summary>A tint of the text colour, so fills read on both the light and the dark theme.</summary>
    private static Color Tint(float alpha)
    {
        return new Color(Fore, alpha);
    }

    private static Label Text(string text, Font font, Color? color = null)
    {
        // Eto in Rhino 8 for Mac on Apple silicon defaults labels to right-aligned.
        var label = new Label { Text = text, Font = font, Wrap = WrapMode.Word, TextAlignment = TextAlignment.Left };
        if (color is Color c)
        {
            label.TextColor = c;
        }

        return label;
    }

    private static Color Mix(Color from, Color to, float amount)
    {
        return new Color(
            from.R + (to.R - from.R) * amount,
            from.G + (to.G - from.G) * amount,
            from.B + (to.B - from.B) * amount,
            from.A);
    }

    /// <summary>Trims <paramref name="text" /> to <paramref name="width" /> with an ellipsis at its start or end.</summary>
    private static string Fit(Graphics g, Font font, string text, float width, bool keepEnd)
    {
        if (g.MeasureString(font, text).Width <= width)
        {
            return text;
        }

        string Trimmed(int keep)
        {
            return keepEnd ? "…" + text.Substring(text.Length - keep) : text.Substring(0, keep) + "…";
        }

        int fits = 0, tooLong = text.Length;
        while (tooLong - fits > 1)
        {
            var mid = (fits + tooLong) / 2;
            if (g.MeasureString(font, Trimmed(mid)).Width <= width)
            {
                fits = mid;
            }
            else
            {
                tooLong = mid;
            }
        }

        return Trimmed(fits);
    }

    private static void DrawCentered(Graphics g, Font font, Color color, string text, float width, float top)
    {
        text = Fit(g, font, text, width - 16, keepEnd: false);
        var size = g.MeasureString(font, text);
        g.DrawText(font, color, (width - size.Width) / 2, top, text);
    }

    /// <summary>Three components and two wires: a Grasshopper definition at icon size.</summary>
    private static void DrawDefinitionGlyph(Graphics g, RectangleF box, Color color)
    {
        var s = Math.Min(box.Width, box.Height);
        var x = box.X + (box.Width - s) / 2;
        var y = box.Y + (box.Height - s) / 2;

        PointF At(float u, float v)
        {
            return new PointF(x + u * s, y + v * s);
        }

        void Node(float u, float v)
        {
            g.FillPath(color, GraphicsPath.GetRoundRect(new RectangleF(At(u, v), new SizeF(0.34f * s, 0.24f * s)), 0.07f * s));
        }

        Node(0.06f, 0.14f);
        Node(0.06f, 0.62f);
        Node(0.60f, 0.38f);

        var wires = new GraphicsPath();
        wires.AddBezier(At(0.40f, 0.26f), At(0.52f, 0.26f), At(0.48f, 0.50f), At(0.60f, 0.50f));
        wires.StartFigure();
        wires.AddBezier(At(0.40f, 0.74f), At(0.52f, 0.74f), At(0.48f, 0.50f), At(0.60f, 0.50f));
        g.DrawPath(new Pen(color, Math.Max(1f, 0.07f * s)), wires);
    }

    private static void DrawAccentTile(Graphics g, RectangleF tile)
    {
        g.FillPath(new Color(Accent, 0.2f), GraphicsPath.GetRoundRect(tile, tile.Width / 4));
        tile.Inflate(-tile.Width / 4, -tile.Height / 4);
        DrawDefinitionGlyph(g, tile, Accent);
    }

    /// <summary>A painted control that behaves like a button: hover, press, focus, Enter or Space.</summary>
    private abstract class Pressable : Drawable
    {
        protected Pressable()
        {
            CanFocus = true;
            Cursor = Cursors.Pointer;
        }

        protected bool Hover { get; private set; }
        protected bool Pressed { get; private set; }

        public event EventHandler<EventArgs>? Click;

        protected override void OnMouseEnter(MouseEventArgs e)
        {
            base.OnMouseEnter(e);
            Hover = true;
            Invalidate();
        }

        protected override void OnMouseLeave(MouseEventArgs e)
        {
            base.OnMouseLeave(e);
            Hover = false;
            Pressed = false;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Buttons == MouseButtons.Primary)
            {
                Pressed = true;
                e.Handled = true;
                Invalidate();
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!Pressed)
            {
                return;
            }

            Pressed = false;
            Invalidate();
            if (new RectangleF(Size).Contains(e.Location))
            {
                // Last: a click usually rebuilds the launcher, which disposes this control.
                Click?.Invoke(this, EventArgs.Empty);
            }
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.Key == Keys.Enter || e.Key == Keys.Space)
            {
                e.Handled = true;
                Click?.Invoke(this, EventArgs.Empty);
            }
        }

        protected override void OnGotFocus(EventArgs e)
        {
            base.OnGotFocus(e);
            Invalidate();
        }

        protected override void OnLostFocus(EventArgs e)
        {
            base.OnLostFocus(e);
            Invalidate();
        }
    }

    /// <summary>The whole card opens the file dialog; files dropped anywhere on the launcher light it up.</summary>
    private sealed class DropZone : Pressable
    {
        private const int Tile = 44;
        private bool _dragActive;

        public DropZone()
        {
            Height = (int)Math.Ceiling(24 + Tile + 14 + BoldFont.LineHeight + 4 + SmallFont.LineHeight + 16 + ButtonHeight + 22);
        }

        private static float ButtonHeight => BodyFont.LineHeight + 12;

        public bool DragActive
        {
            set
            {
                if (_dragActive != value)
                {
                    _dragActive = value;
                    Invalidate();
                }
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.AntiAlias = true;
            var width = (float)Width;
            var card = GraphicsPath.GetRoundRect(new RectangleF(0.5f, 0.5f, width - 1, Height - 1), 10);

            var fill = _dragActive ? new Color(Accent, 0.12f) : Tint(Pressed ? 0.08f : Hover ? 0.06f : 0.035f);
            g.FillPath(fill, card);
            var border = _dragActive ? new Pen(Accent, 1.5f) : new Pen(Tint(Hover ? 0.32f : 0.18f), 1f) { DashStyle = new DashStyle(0, 4, 3) };
            g.DrawPath(border, card);
            if (HasFocus)
            {
                g.DrawPath(new Pen(Accent, 2f), GraphicsPath.GetRoundRect(new RectangleF(1, 1, width - 2, Height - 2), 9.5f));
            }

            var top = 24f;
            DrawAccentTile(g, new RectangleF((width - Tile) / 2, top, Tile, Tile));
            top += Tile + 14;

            DrawCentered(g, BoldFont, Fore, _dragActive ? "Drop to open" : "Open a definition", width, top);
            top += BoldFont.LineHeight + 4;
            DrawCentered(g, SmallFont, Dim, "Drop a .gh or .ghx file here, or", width, top);
            top += SmallFont.LineHeight + 16;

            const string label = "Choose file…";
            var labelSize = g.MeasureString(BodyFont, label);
            var button = new RectangleF((width - labelSize.Width - 32) / 2, top, labelSize.Width + 32, ButtonHeight);
            var buttonFill = Pressed ? Mix(Accent, Colors.Black, 0.15f) : Hover ? Mix(Accent, Colors.White, 0.12f) : Accent;
            g.FillPath(buttonFill, GraphicsPath.GetRoundRect(button, 7));
            g.DrawText(BodyFont, OnAccent,
                button.X + (button.Width - labelSize.Width) / 2, button.Y + (button.Height - labelSize.Height) / 2, label);
        }
    }

    private sealed class Card : Drawable
    {
        public Card(Control content, int padding)
        {
            Padding = new Padding(padding);
            Content = content;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.AntiAlias = true;
            var card = GraphicsPath.GetRoundRect(new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), 10);
            g.FillPath(Tint(0.035f), card);
            g.DrawPath(Tint(0.08f), card);
        }
    }

    private sealed class RecentRow : Pressable
    {
        private const int Pad = 8;
        private const int Tile = 30;
        private const int TextLeft = 8 + Tile + 10;

        private readonly string _name;
        private readonly string _folder;

        public RecentRow(string path)
        {
            _name = Path.GetFileNameWithoutExtension(path);
            _folder = Path.GetDirectoryName(path) ?? "";
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (HostUtils.RunningOnOSX && home.Length > 0 && _folder.StartsWith(home, StringComparison.Ordinal))
            {
                _folder = "~" + _folder.Substring(home.Length);
            }

            ToolTip = path;
            Height = (int)Math.Ceiling(Pad * 2 + Math.Max(Tile, BodyFont.LineHeight + 1 + SmallFont.LineHeight));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.AntiAlias = true;
            var active = Hover || Pressed;

            if (active)
            {
                g.FillPath(Tint(Pressed ? 0.11f : 0.07f), GraphicsPath.GetRoundRect(new RectangleF(Size), 7));
            }

            if (HasFocus)
            {
                g.DrawPath(Accent, GraphicsPath.GetRoundRect(new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), 7));
            }

            var tile = new RectangleF(8, (Height - Tile) / 2f, Tile, Tile);
            g.FillPath(Tint(active ? 0.1f : 0.06f), GraphicsPath.GetRoundRect(tile, 7));
            tile.Inflate(-8, -8);
            DrawDefinitionGlyph(g, tile, active ? Fore : Dim);

            var chevronSpace = active ? 22 : 8;
            var textWidth = Width - TextLeft - chevronSpace;
            var textTop = (Height - (BodyFont.LineHeight + 1 + SmallFont.LineHeight)) / 2;
            g.DrawText(BodyFont, Fore, TextLeft, textTop, Fit(g, BodyFont, _name, textWidth, keepEnd: false));
            g.DrawText(SmallFont, Dim, TextLeft, textTop + BodyFont.LineHeight + 1,
                Fit(g, SmallFont, _folder, textWidth, keepEnd: true));

            if (active)
            {
                var cx = Width - 14f;
                var cy = Height / 2f;
                var chevron = new GraphicsPath();
                chevron.AddLines(new PointF(cx - 2.5f, cy - 4.5f), new PointF(cx + 2f, cy), new PointF(cx - 2.5f, cy + 4.5f));
                g.DrawPath(new Pen(Dim, 1.5f), chevron);
            }
        }
    }

    private sealed class OpeningHeader : Drawable
    {
        private const int Tile = 44;
        private readonly string _name;

        public OpeningHeader(string name)
        {
            _name = name;
            Height = (int)Math.Ceiling(12 + Tile + 12 + BoldFont.LineHeight + 3 + SmallFont.LineHeight + 4);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.AntiAlias = true;
            var width = (float)Width;
            var top = 12f;
            DrawAccentTile(g, new RectangleF((width - Tile) / 2, top, Tile, Tile));
            top += Tile + 12;
            DrawCentered(g, BoldFont, Fore, _name, width, top);
            top += BoldFont.LineHeight + 3;
            DrawCentered(g, SmallFont, Dim, "Opening in Selva", width, top);
        }
    }

    private enum StepState
    {
        Done,
        Active,
        Pending
    }

    /// <summary>Static on purpose: each step blocks the UI thread, so nothing could animate.</summary>
    private sealed class StepRow : Drawable
    {
        public const int TextLeft = 36;
        private const float Dot = 18;

        private readonly string _label;
        private readonly StepState _state;

        public StepRow(string label, StepState state)
        {
            _label = label;
            _state = state;
            Height = (int)Math.Ceiling(BoldFont.LineHeight + 16);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.AntiAlias = true;
            var cx = 8 + Dot / 2;
            var cy = Height / 2f;
            var dot = new RectangleF(cx - Dot / 2, cy - Dot / 2, Dot, Dot);

            if (_state == StepState.Done)
            {
                g.FillEllipse(Accent, dot);
                var check = new GraphicsPath();
                check.AddLines(new PointF(cx - 4, cy + 0.5f), new PointF(cx - 1, cy + 3.5f), new PointF(cx + 4.5f, cy - 3));
                g.DrawPath(new Pen(OnAccent, 1.8f), check);
            }
            else if (_state == StepState.Active)
            {
                dot.Inflate(-1, -1);
                g.DrawEllipse(new Pen(Accent, 2f), dot);
                g.FillEllipse(Accent, new RectangleF(cx - 3.5f, cy - 3.5f, 7, 7));
            }
            else
            {
                dot.Inflate(-0.75f, -0.75f);
                g.DrawEllipse(new Pen(Tint(0.25f), 1.5f), dot);
            }

            var font = _state == StepState.Active ? BoldFont : BodyFont;
            g.DrawText(font, _state == StepState.Pending ? Dim : Fore, TextLeft, (Height - font.LineHeight) / 2,
                Fit(g, font, _label, Width - TextLeft - 8, keepEnd: false));
        }
    }

    /// <summary>
    ///     Painted rather than a wrapping Label: Rhino for Mac lays wrapped labels out at unbounded
    ///     width and right-aligns them, which pushes the text off the card. Two lines, the second elided.
    /// </summary>
    private sealed class StepHint : Drawable
    {
        private const int Lines = 2;
        private const int Bottom = 10;
        private readonly string _text;

        public StepHint(string text)
        {
            _text = text;
            Height = (int)Math.Ceiling(SmallFont.LineHeight * Lines + Bottom);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var width = Width - StepRow.TextLeft - 8;
            var top = 0f;
            var rest = _text;
            for (var line = 0; line < Lines && rest.Length > 0; line++)
            {
                var last = line == Lines - 1;
                var take = last ? rest : FirstLine(g, rest, width);
                g.DrawText(SmallFont, Dim, StepRow.TextLeft, top, last ? Fit(g, SmallFont, take, width, keepEnd: false) : take);
                rest = rest.Substring(take.Length).TrimStart();
                top += SmallFont.LineHeight;
            }
        }

        /// <summary>The longest run of whole words that fits <paramref name="width" />; one word if none does.</summary>
        private static string FirstLine(Graphics g, string text, float width)
        {
            var end = 0;
            for (var next = text.IndexOf(' '); ; next = text.IndexOf(' ', next + 1))
            {
                var candidate = next < 0 ? text : text.Substring(0, next);
                if (end > 0 && g.MeasureString(SmallFont, candidate).Width > width)
                {
                    break;
                }

                end = candidate.Length;
                if (next < 0)
                {
                    break;
                }
            }

            return text.Substring(0, end);
        }
    }

    private sealed class ErrorBox : Drawable
    {
        public ErrorBox(string message)
        {
            Padding = new Padding(12, 9, 10, 9);
            Content = Text(message, BodyFont, Fore);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.AntiAlias = true;
            var shape = GraphicsPath.GetRoundRect(new RectangleF(Size), 8);
            g.FillPath(new Color(Danger, 0.14f), shape);
            g.SetClip(shape);
            g.FillRectangle(Danger, 0, 0, 3, Height);
        }
    }
}
