using Grasshopper;
using Grasshopper.Kernel;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Ends the Display caches' lifetime with the definitions that filled them: closing any
///     Grasshopper document empties both, so a closed definition holds no memory. A definition
///     still open misses once on its next solve.
/// </summary>
public static class DisplayCaches
{
    /// <summary>
    ///     Desktop only. Rhino.Compute can load and drop a definition per request, and clearing
    ///     there would empty the caches before a repeat request could hit; its byte bounds are the
    ///     only limit.
    /// </summary>
    public static void ClearOnDocumentClose()
    {
        Instances.DocumentServer.DocumentRemoved += OnDocumentRemoved;
    }

    private static void OnDocumentRemoved(GH_DocumentServer sender, GH_Document doc)
    {
        MeshItemCache.Clear();
        GeometryBlobStore.Clear();
    }
}
