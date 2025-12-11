using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Attributes;

namespace Selva.Features.FileIO.Components;

/// <summary>
/// Base class for rendering component capsules with a custom accent color.
/// Provides automatic icon positioning between input and output parameters.
/// </summary>
public abstract class GH_AccentComponentAttributes : GH_ComponentAttributes
{
  /// <summary>
  /// Gets the accent color to use for the vertical bar on the right side of the component.
  /// Override this property in derived classes to change the color.
  /// </summary>
  protected abstract Color AccentColor { get; }

  protected GH_AccentComponentAttributes(IGH_Component component) : base(component)
  {
  }

  protected override void Render(GH_Canvas canvas, Graphics graphics, Grasshopper.GUI.Canvas.GH_CanvasChannel channel)
  {
    // For the Objects channel, we intercept and render with custom color
    if (channel == Grasshopper.GUI.Canvas.GH_CanvasChannel.Objects)
    {
      RenderComponentCapsuleWithAccent(canvas, graphics);
      return;
    }

    // For all other channels (like Wires), use base rendering
    base.Render(canvas, graphics, channel);
  }

  private void RenderComponentCapsuleWithAccent(GH_Canvas canvas, Graphics graphics)
  {
    // Get the component's palette based on its state
    var palette = GH_CapsuleRenderEngine.GetImpliedPalette(Owner);

    // Create a capsule with the component's bounds and palette
    var capsule = GH_Capsule.CreateCapsule(Bounds, palette);

    // Add parameter grips
    bool hasInput = Owner.Params.Input.Count > 0;
    bool hasOutput = Owner.Params.Output.Count > 0;
    capsule.SetJaggedEdges(!hasInput, !hasOutput);

    foreach (var param in Owner.Params.Input)
      capsule.AddInputGrip(param.Attributes.InputGrip.Y);

    foreach (var param in Owner.Params.Output)
      capsule.AddOutputGrip(param.Attributes.OutputGrip.Y);

    // Render base capsule
    graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
    capsule.Render(graphics, AccentColor);

    // Get the icon to render
    var icon = Owner.Icon_24x24;
    if (Owner.Locked && Owner.Icon_24x24_Locked != null)
      icon = Owner.Icon_24x24_Locked;

    capsule.Dispose();

    // Manually render icon in the middle between input and output text bounds
    // Only render icon if zoom level is sufficient (hide at extreme zoom out, like default Grasshopper behavior)
    if (icon != null && (hasInput || hasOutput) && canvas.Viewport.Zoom > 0.6f)
    {
      float middleY;
      float iconX;

      if (hasInput && hasOutput)
      {
        float inputBottom = Owner.Params.Input.Last().Attributes.Bounds.Bottom;
        float outputTop = Owner.Params.Output.First().Attributes.Bounds.Top;
        middleY = (inputBottom + outputTop) / 2f;

        // Position icon between input bounds right edge and output bounds left edge
        float inputRight = Owner.Params.Input.Last().Attributes.Bounds.Right;
        float outputLeft = Owner.Params.Output.First().Attributes.Bounds.Left;
        iconX = (inputRight + outputLeft) / 2f - 12f; // Icon is 24x24, so offset by half
      }
      else if (hasInput)
      {
        // Only input: position icon to the right of input text
        float inputRight = Owner.Params.Input.Last().Attributes.Bounds.Right;
        iconX = inputRight + 5f;
        var inputBounds = Owner.Params.Input.Last().Attributes.Bounds;
        middleY = (inputBounds.Top + inputBounds.Bottom) / 2f - 12f;
      }
      else
      {
        // Only output: position icon to the left of output text
        float outputLeft = Owner.Params.Output.First().Attributes.Bounds.Left;
        iconX = outputLeft - 29f; // Icon is 24x24, plus 5px margin
        var outputBounds = Owner.Params.Output.First().Attributes.Bounds;
        middleY = (outputBounds.Top + outputBounds.Bottom) / 2f - 12f;
      }

      float iconY = middleY - 12f; // Icon is 24x24, so offset by half

      graphics.DrawImageUnscaled(icon, (int)iconX, (int)iconY);
    }

    // Now render the parameters on top
    var impliedStyle = GH_CapsuleRenderEngine.GetImpliedStyle(palette, Selected, Owner.Locked, Owner.Hidden);
    GH_ComponentAttributes.RenderComponentParameters(canvas, graphics, Owner, impliedStyle);
  }
}
