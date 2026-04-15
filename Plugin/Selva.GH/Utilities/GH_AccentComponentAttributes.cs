using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Attributes;
using GH_CanvasChannel = Grasshopper.GUI.Canvas.GH_CanvasChannel;
using static Grasshopper.GUI.GH_GraphicsUtil;

namespace Selva.GH.Utilities;

/// <summary>
///     Base class for rendering component capsules with a custom accent color.
///     Provides automatic icon positioning between input and output parameters.
/// </summary>
public abstract class GH_AccentComponentAttributes : GH_ComponentAttributes
{
    private const float ZoomThreshold = 0.6f;

    private const double FadeDurationMs = 400.0;

    // Timestamp when the fade transition started.
    private DateTime _fadeStart;

    // Timer that keeps the canvas refreshing while a fade is in progress.
    private Timer _fadeTimer;

    // Direction: true = fading in, false = fading out.
    private bool _fadingIn;

    // Current 0–1 opacity of the icon; drives RenderFadedImage each frame.
    private double _iconOpacity = 1.0;

    // Whether the first render has happened yet (used to sync state without triggering a fade).
    private bool _initialized;

    // Whether the icon was visible (above threshold) on the last frame.
    private bool _wasVisible = true;

    protected GH_AccentComponentAttributes(IGH_Component component) : base(component)
    {
    }


    /// <summary>
    ///     Gets the accent color to use for the vertical bar on the right side of the component.
    ///     Override this property in derived classes to change the color.
    /// </summary>
    protected abstract Color AccentColor { get; }

    protected override void Render(GH_Canvas canvas, Graphics graphics, GH_CanvasChannel channel)
    {
        if (channel == GH_CanvasChannel.Objects)
        {
            RenderComponentCapsuleWithAccent(canvas, graphics);
            return;
        }

        base.Render(canvas, graphics, channel);
    }

    private void RenderComponentCapsuleWithAccent(GH_Canvas canvas, Graphics graphics)
    {
        var palette = GH_CapsuleRenderEngine.GetImpliedPalette(Owner);
        var capsule = GH_Capsule.CreateCapsule(Bounds, palette);


        var hasInput = Owner.Params.Input.Count > 0;
        var hasOutput = Owner.Params.Output.Count > 0;
        capsule.SetJaggedEdges(!hasInput, !hasOutput);

        foreach (var param in Owner.Params.Input)
        {
            capsule.AddInputGrip(param.Attributes.InputGrip.Y);
        }

        foreach (var param in Owner.Params.Output)
        {
            capsule.AddOutputGrip(param.Attributes.OutputGrip.Y);
        }

        graphics.SmoothingMode = SmoothingMode.HighQuality;

        var isNormalState = palette == GH_Palette.Normal || palette == GH_Palette.Hidden;
        if (isNormalState && !Selected)
        {
            var renderColor = Owner.Hidden ? MuteColor(AccentColor) : AccentColor;
            capsule.Render(graphics, renderColor);
        }
        else
        {
            capsule.Render(graphics, Selected, Owner.Locked, Owner.Hidden);
        }

        var icon = Owner.Icon_24x24;
        if (Owner.Locked && Owner.Icon_24x24_Locked != null)
        {
            icon = Owner.Icon_24x24_Locked;
        }

        capsule.Dispose();

        if (icon != null && (hasInput || hasOutput))
        {
            var isVisible = canvas.Viewport.Zoom >= ZoomThreshold;

            // On the very first render, snap to the correct state without animating.
            if (!_initialized)
            {
                _wasVisible = isVisible;
                _iconOpacity = isVisible ? 1.0 : 0.0;
                _initialized = true;
            }

            // Detect threshold crossing and start a timed fade.
            if (isVisible != _wasVisible)
            {
                _fadingIn = isVisible;
                _fadeStart = DateTime.UtcNow;
                _wasVisible = isVisible;
                StartFadeTimer(canvas);
            }

            // Only advance opacity while a fade is in progress.
            if (_fadeTimer != null)
            {
                var elapsed = (DateTime.UtcNow - _fadeStart).TotalMilliseconds;
                var t = Math.Min(1.0, elapsed / FadeDurationMs);
                _iconOpacity = _fadingIn ? t : 1.0 - t;

                if (t >= 1.0)
                {
                    StopFadeTimer();
                }
            }

            if (_iconOpacity > 0.0)
            {
                float middleY;
                float iconX;

                if (hasInput && hasOutput)
                {
                    var inputBottom = Owner.Params.Input.Last().Attributes.Bounds.Bottom;
                    var outputTop = Owner.Params.Output.First().Attributes.Bounds.Top;
                    middleY = (inputBottom + outputTop) / 2f;
                    var inputRight = Owner.Params.Input.Last().Attributes.Bounds.Right;
                    var outputLeft = Owner.Params.Output.First().Attributes.Bounds.Left;
                    iconX = (inputRight + outputLeft) / 2f - 12f;
                }
                else if (hasInput)
                {
                    var inputRight = Owner.Params.Input.Last().Attributes.Bounds.Right;
                    iconX = inputRight + 5f;
                    var inputBounds = Owner.Params.Input.Last().Attributes.Bounds;
                    middleY = (inputBounds.Top + inputBounds.Bottom) / 2f;
                }
                else
                {
                    var outputLeft = Owner.Params.Output.First().Attributes.Bounds.Left;
                    iconX = outputLeft - 29f;
                    var outputBounds = Owner.Params.Output.First().Attributes.Bounds;
                    middleY = (outputBounds.Top + outputBounds.Bottom) / 2f;
                }

                var iconY = middleY - 12f;
                var iconRect = new Rectangle((int)iconX, (int)iconY, 24, 24);
                RenderFadedImage(graphics, icon, iconRect, _iconOpacity);
            }
        }

        var impliedStyle = GH_CapsuleRenderEngine.GetImpliedStyle(palette, Selected, Owner.Locked, Owner.Hidden);
        RenderComponentParameters(canvas, graphics, Owner, impliedStyle);

        if (Owner.Obsolete && canvas.DrawingMode == GH_CanvasMode.Control)
        {
            RenderObjectOverlay(graphics, Owner, ContentBox);
        }
    }

    private void StartFadeTimer(GH_Canvas canvas)
    {
        if (_fadeTimer != null)
        {
            return;
        }

        _fadeTimer = new Timer { Interval = 16 }; // ~60 fps
        _fadeTimer.Tick += (_, _) => canvas.Refresh();
        _fadeTimer.Start();
    }

    private void StopFadeTimer()
    {
        if (_fadeTimer == null)
        {
            return;
        }

        _fadeTimer.Stop();
        _fadeTimer.Dispose();
        _fadeTimer = null;
    }

    private static Color MuteColor(Color color)
    {
        const float blend = 0.45f;
        const int grey = 180;
        var r = (int)(color.R + (grey - color.R) * blend);
        var g = (int)(color.G + (grey - color.G) * blend);
        var b = (int)(color.B + (grey - color.B) * blend);
        return Color.FromArgb(color.A, r, g, b);
    }
}
