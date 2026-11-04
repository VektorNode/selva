#nullable enable
using Grasshopper.Kernel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Keeps the Rhino viewport preview of the document the panel shows. Grasshopper draws a
///     document's preview only while its editor is visible, so with the editor hidden or minimized
///     and the panel as the only UI, the geometry would vanish. UI thread only.
/// </summary>
/// <remarks>
///     A forced preview draws even for a disabled document, and only the canvas's document is
///     enabled. The force follows <see cref="GH_Document.Enabled" />, so a document paused behind
///     another on the canvas stops drawing.
/// </remarks>
internal static class PanelPreview
{
    private static GH_Document? _document;
    private static string? _sessionId;

    public static GH_Document? Document => _document;

    public static string? SessionId => _sessionId;

    public static void Show(GH_Document document, string sessionId)
    {
        if (_document != document)
        {
            Release();
            _document = document;
            _document.EnabledChanged += OnEnabledChanged;
        }

        _sessionId = sessionId;
        document.ForcePreview(document.Enabled);
    }

    /// <summary>Only if the panel still shows that session, as <see cref="RhinoPanelHost.Clear" />.</summary>
    public static void Clear(string sessionId)
    {
        if (_sessionId == sessionId)
        {
            Release();
        }
    }

    private static void Release()
    {
        if (_document == null)
        {
            return;
        }

        _document.EnabledChanged -= OnEnabledChanged;
        _document.ForcePreview(false);
        _document = null;
        _sessionId = null;
    }

    private static void OnEnabledChanged(object sender, GH_DocEnabledEventArgs e)
    {
        if (sender is GH_Document document && document == _document)
        {
            document.ForcePreview(e.Enabled);
        }
    }
}
