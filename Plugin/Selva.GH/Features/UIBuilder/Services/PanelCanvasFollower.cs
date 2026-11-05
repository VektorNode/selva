#nullable enable
using System.Linq;
using Grasshopper;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Selva.GH.Features.UIBuilder.Components;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Keeps the panel on the canvas's document. Only that document solves, so a page left on a
///     document behind it takes input and never answers. UI thread only.
/// </summary>
internal static class PanelCanvasFollower
{
    public static void Register()
    {
        Instances.CanvasCreated += Attach;
        if (Instances.ActiveCanvas != null)
        {
            Attach(Instances.ActiveCanvas);
        }
    }

    private static void Attach(GH_Canvas canvas)
    {
        canvas.DocumentChanged -= OnDocumentChanged;
        canvas.DocumentChanged += OnDocumentChanged;
    }

    private static void OnDocumentChanged(GH_Canvas sender, GH_CanvasDocumentChangedEventArgs e)
    {
        // A player session moves the canvas behind the hidden editor and drives the panel itself.
        if (!DefinitionLauncher.IsEditorVisible() || e.NewDocument == PanelPreview.Document)
        {
            return;
        }

        var bridge = e.NewDocument?.Objects.OfType<GH_UIBuilderComponent>().FirstOrDefault(b => b.IsConnected);
        if (bridge != null)
        {
            bridge.FollowCanvas();
        }
        else if (PanelPreview.SessionId != null)
        {
            // A bridge with Enable on hasn't started yet: its cold start shows the panel again.
            RhinoPanelHost.Clear(PanelPreview.SessionId);
        }
    }
}
