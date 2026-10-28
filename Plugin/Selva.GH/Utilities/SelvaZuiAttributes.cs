using System.Drawing;
using System.Windows.Forms;
using Grasshopper.GUI;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Attributes;

namespace Selva.GH.Utilities;

/// <summary>
///     Rhino 8's Model-component buttons: once zoomed in, a filled chevron under the parameters
///     shows the hidden inputs and a hollow one above them hides the unused ones. Shift and Ctrl
///     double-click do the same.
/// </summary>
internal sealed class SelvaZuiAttributes : GH_ComponentAttributes
{
    // ZoomFadeHigh below this keeps the buttons hidden, as on Rhino's components.
    private const int MinAlpha = 5;
    private const float Radius = 3f;

    private RectangleF _hideButton;
    private RectangleF _showButton;

    public SelvaZuiAttributes(SelvaZuiComponent owner) : base(owner)
    {
    }

    private SelvaZuiComponent Zui => (SelvaZuiComponent)Owner;

    private static bool ButtonsVisible => GH_Canvas.ZoomFadeHigh >= MinAlpha;

    protected override void Layout()
    {
        base.Layout();
        var x = ContentBox.X + ContentBox.Width * 0.5f;
        _hideButton = new RectangleF(x - Radius, ContentBox.Top - Radius, 2 * Radius, 2 * Radius);
        _showButton = new RectangleF(x - Radius, ContentBox.Bottom - Radius, 2 * Radius, 2 * Radius);
    }

    protected override void Render(GH_Canvas canvas, Graphics graphics, GH_CanvasChannel channel)
    {
        base.Render(canvas, graphics, channel);
        if (channel != GH_CanvasChannel.Objects || !ButtonsVisible)
        {
            return;
        }

        var alpha = GH_Canvas.ZoomFadeHigh;
        if (Zui.HasHiddenInputs)
        {
            RenderButton(graphics, _showButton, true, alpha);
        }

        if (Zui.HasUnusedInputs)
        {
            RenderButton(graphics, _hideButton, false, alpha);
        }
    }

    public override GH_ObjectResponse RespondToMouseDown(GH_Canvas sender, GH_CanvasMouseEvent e)
    {
        if (e.Button == MouseButtons.Left && ButtonsVisible)
        {
            if (_showButton.Contains(e.CanvasLocation) && Zui.HasHiddenInputs)
            {
                Zui.ShowAllInputsAction();
                return GH_ObjectResponse.Handled;
            }

            if (_hideButton.Contains(e.CanvasLocation) && Zui.HasUnusedInputs)
            {
                Zui.HideUnusedInputsAction();
                return GH_ObjectResponse.Handled;
            }
        }

        return base.RespondToMouseDown(sender, e);
    }

    public override GH_ObjectResponse RespondToMouseDoubleClick(GH_Canvas sender, GH_CanvasMouseEvent e)
    {
        if (e.Button == MouseButtons.Left)
        {
            switch (Control.ModifierKeys)
            {
                case Keys.Shift:
                    sender.ActiveInteraction = null;
                    Zui.ShowAllInputsAction();
                    return GH_ObjectResponse.Handled;
                case Keys.Control:
                    sender.ActiveInteraction = null;
                    Zui.HideUnusedInputsAction();
                    return GH_ObjectResponse.Handled;
            }
        }

        return base.RespondToMouseDoubleClick(sender, e);
    }

    public override void SetupTooltip(PointF canvasPoint, GH_TooltipDisplayEventArgs e)
    {
        if (ButtonsVisible)
        {
            if (_hideButton.Contains(canvasPoint) && Zui.HasUnusedInputs)
            {
                e.Title = "Hide Parameters";
                e.Text = "Hide all unused parameters.\nCtrl + Dbl Click";
                return;
            }

            if (_showButton.Contains(canvasPoint) && Zui.HasHiddenInputs)
            {
                e.Title = "Show Parameters";
                e.Text = "Show all available parameters.\nShift + Dbl Click";
                return;
            }
        }

        base.SetupTooltip(canvasPoint, e);
    }

    private static void RenderButton(Graphics graphics, RectangleF bounds, bool expand, int alpha)
    {
        using (var fill = new SolidBrush(Color.FromArgb(alpha, expand ? Color.Black : Color.White)))
        using (var edge = new Pen(Color.FromArgb(alpha, Color.Black), 0.5f))
        {
            graphics.FillEllipse(fill, bounds);
            graphics.DrawEllipse(edge, bounds);
        }

        var cx = bounds.X + bounds.Width * 0.5f;
        var cy = bounds.Y + bounds.Height * 0.5f;
        var dx = 1.3f;
        var dy = expand ? 0.7f : -0.7f;
        using var glyph = new Pen(Color.FromArgb(alpha, expand ? Color.White : Color.Black), 0.75f);
        graphics.DrawLines(glyph, new[]
        {
            new PointF(cx - dx, cy - dy),
            new PointF(cx, cy + dy),
            new PointF(cx + dx, cy - dy)
        });
    }
}
