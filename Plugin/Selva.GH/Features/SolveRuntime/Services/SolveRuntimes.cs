using System.Runtime.CompilerServices;
using Grasshopper.Kernel;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     Entry point to the solve runtime: one <see cref="DocumentSolveRuntime" /> per document,
///     created by whichever Selva component asks first. Not a canvas component, so no author
///     has to place it.
/// </summary>
/// <remarks>
///     Static because components are created by Grasshopper, which cannot inject anything.
/// </remarks>
public static class SolveRuntimes
{
    private static readonly ConditionalWeakTable<GH_Document, DocumentSolveRuntime> Runtimes =
        new ConditionalWeakTable<GH_Document, DocumentSolveRuntime>();

    /// <summary>Null for a null document, so callers can pass <c>OnPingDocument()</c> straight in.</summary>
    public static DocumentSolveRuntime For(GH_Document document) =>
        document == null ? null : Runtimes.GetValue(document, d => new DocumentSolveRuntime(d));
}
