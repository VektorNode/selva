using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Linq;
using System.Windows.Forms;
using Grasshopper.GUI;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Draws a Selva Get param as Rhino draws its own (Get Number, Get Geometry): icon and nickname in
///     a hook-shaped capsule, double-click to edit the prompt, the contextual settings in the tooltip.
///     Unlike Rhino's, the capsule takes the warning and error colors, because these params report
///     problems (a file that will not import) that Rhino's never have.
/// </summary>
public sealed class SelvaContextualParameterAttributes<T> : GH_Attributes<SelvaContextualParameter<T>>
    where T : class, IGH_Goo
{
    private const float HookRadius = 3f;

    private static Graphics _pickGraphics;

    private RectangleF _iconBounds;
    private RectangleF _nameBounds;

    public SelvaContextualParameterAttributes(SelvaContextualParameter<T> owner) : base(owner)
    {
    }

    public override bool HasInputGrip => true;
    public override bool HasOutputGrip => true;

    // The capsule color and the tooltip carry the runtime messages instead.
    public override bool AllowMessageBalloon => false;

    protected override void Layout()
    {
        Pivot = GH_Convert.ToPoint(Pivot);
        var nameWidth = Math.Max(GH_FontServer.StringWidth(Owner.NickName, GH_FontServer.StandardAdjusted) + 10, 75);
        _iconBounds = new RectangleF(Pivot.X - 24f, Pivot.Y, 24f, 24f);
        _nameBounds = new RectangleF(Pivot.X, Pivot.Y, nameWidth, 24f);

        var bounds = RectangleF.Union(_nameBounds, _iconBounds);
        bounds.Inflate(1f, 1f);
        bounds.Width += 12f;
        Bounds = bounds;
        _iconBounds.Offset(1.5f, 0.5f);
    }

    public override bool IsPickRegion(PointF point)
    {
        if (!Bounds.Contains(point))
        {
            return false;
        }

        using var path = ToHookShape(Bounds, HookRadius);
        return path.IsVisible(point);
    }

    public override bool IsPickRegion(RectangleF box, GH_PickBox method)
    {
        switch (method)
        {
            case GH_PickBox.Window:
                return box.Contains(Bounds);
            case GH_PickBox.Crossing:
                if (box.Contains(Bounds))
                {
                    return true;
                }

                if (!box.IntersectsWith(Bounds))
                {
                    return false;
                }

                using (var path = ToHookShape(Bounds, HookRadius))
                using (var region = new Region(path))
                {
                    region.Intersect(box);
                    _pickGraphics ??= Graphics.FromImage(new Bitmap(5, 5, PixelFormat.Format32bppArgb));
                    return !region.IsEmpty(_pickGraphics);
                }
            default:
                return false;
        }
    }

    public override GH_ObjectResponse RespondToMouseDoubleClick(GH_Canvas sender, GH_CanvasMouseEvent e)
    {
        if (e.Button == MouseButtons.Left)
        {
            Owner.EditPromptDialog();
            return GH_ObjectResponse.Handled;
        }

        return base.RespondToMouseDoubleClick(sender, e);
    }

    protected override void Render(GH_Canvas canvas, Graphics graphics, GH_CanvasChannel channel)
    {
        if (channel == GH_CanvasChannel.Wires)
        {
            RenderIncomingWires(canvas.Painter, Owner.Sources, Owner.WireDisplay);
            return;
        }

        if (channel != GH_CanvasChannel.Objects)
        {
            base.Render(canvas, graphics, channel);
            return;
        }

        var bounds = Bounds;
        if (!canvas.Viewport.IsVisible(ref bounds, 5f))
        {
            return;
        }

        GH_CapsuleRenderEngine.RenderInputGrip(graphics, canvas.Viewport.Zoom, InputGrip, true);
        GH_CapsuleRenderEngine.RenderOutputGrip(graphics, canvas.Viewport.Zoom, OutputGrip, true);

        var style = GH_CapsuleRenderEngine.GetImpliedStyle(GH_CapsuleRenderEngine.GetImpliedPalette(Owner), Selected,
            Owner.Locked, false);

        using (var shape = ToHookShape(bounds, HookRadius))
        using (var fill = style.CreateBrush(bounds, canvas.Viewport.Zoom))
        using (var edge = new Pen(style.Edge))
        {
            graphics.FillPath(fill, shape);
            graphics.DrawPath(edge, shape);
        }

        var highlightAlpha = Convert.ToInt32(0.75f * GH_Canvas.ZoomFadeMedium);
        if (highlightAlpha > 0)
        {
            var inner = bounds;
            inner.Inflate(-1f, -1f);
            inner.Width -= 0.5f;
            using var highlightShape = ToHookShape(inner, 2f);
            using var gradient = new LinearGradientBrush(inner, Color.FromArgb(highlightAlpha, Color.White),
                Color.FromArgb(0, Color.White), LinearGradientMode.Vertical) { WrapMode = WrapMode.TileFlipXY };
            using var highlight = new Pen(gradient);
            graphics.DrawPath(highlight, highlightShape);
        }

        if (GH_Canvas.ZoomFadeLow > 0 && !string.IsNullOrWhiteSpace(Owner.NickName))
        {
            var center = new PointF(_nameBounds.X + _nameBounds.Width * 0.5f, _nameBounds.Y + _nameBounds.Height * 0.5f);
            GH_GraphicsUtil.RenderCenteredText(graphics, Owner.NickName, GH_FontServer.StandardAdjusted, style.Text,
                center);
            GH_GraphicsUtil.RenderIcon(graphics, _iconBounds, Owner.Icon_24x24);
        }
    }

    public override void SetupTooltip(PointF point, GH_TooltipDisplayEventArgs e)
    {
        e.Title = Owner.Name.Equals(Owner.NickName, StringComparison.Ordinal)
            ? Owner.Name
            : $"{Owner.Name} ({Owner.NickName})";
        e.Icon = Owner.Icon_24x24;
        e.Text = Owner.Description;

        var atMost = Owner.AtMost < int.MaxValue ? Owner.AtMost.ToString() : "unlimited";
        var description =
            $"At least: {Owner.AtLeast}{Environment.NewLine}At most: {atMost}{Environment.NewLine}Prompt: {Owner.ImpliedPrompt}";

        var messages = Owner.RuntimeMessages(GH_RuntimeMessageLevel.Error)
            .Concat(Owner.RuntimeMessages(GH_RuntimeMessageLevel.Warning))
            .Concat(Owner.RuntimeMessages(GH_RuntimeMessageLevel.Remark))
            .ToList();
        if (messages.Count > 0)
        {
            description += Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine, messages);
        }

        e.Description = description;
    }

    // Rounded on the left, a half-circle hook on the right: the shape of Rhino's contextual params.
    private static GraphicsPath ToHookShape(RectangleF rec, float radius)
    {
        var half = rec.Height / 2f;
        var tan = radius * 0.41421f;
        var inset = radius * 0.29289f;
        var diagonal = radius * 0.70711f;

        var x0 = rec.X;
        var x1 = x0 + radius;
        var x2 = rec.Right - half - tan;
        var x3 = rec.Right - half + inset;
        var x4 = rec.Right - diagonal;
        var y0 = rec.Y;
        var y1 = y0 + inset;
        var y2 = y0 + radius;
        var y3 = y0 + half - diagonal;
        var y4 = y0 + half + diagonal;
        var y5 = rec.Bottom - radius;
        var y6 = rec.Bottom - inset;
        var y7 = rec.Bottom;

        var path = new GraphicsPath();
        GH_GraphicsUtil.AppendArc(new PointF(x0, y2), new PointF(x1, y0), new SizeF(0f, -1f), path);
        GH_GraphicsUtil.AppendArc(new PointF(x2, y0), new PointF(x3, y1), new SizeF(1f, 0f), path);
        GH_GraphicsUtil.AppendArc(new PointF(x4, y3), new PointF(x4, y4), new SizeF(1f, 1f), path);
        GH_GraphicsUtil.AppendArc(new PointF(x3, y6), new PointF(x2, y7), new SizeF(-1f, 1f), path);
        GH_GraphicsUtil.AppendArc(new PointF(x1, y7), new PointF(x0, y5), new SizeF(-1f, 0f), path);
        path.CloseFigure();
        return path;
    }
}
