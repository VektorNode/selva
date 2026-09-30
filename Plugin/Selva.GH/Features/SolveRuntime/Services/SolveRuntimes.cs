using System;
using System.Runtime.CompilerServices;
using Grasshopper.Kernel;
using Selva.Schema.Models;

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

    private static Action<SolveEvent> _localTransport;

    /// <summary>Null for a null document, so callers can pass <c>OnPingDocument()</c> straight in.</summary>
    public static DocumentSolveRuntime For(GH_Document document) =>
        document == null ? null : Runtimes.GetValue(document, d => new DocumentSolveRuntime(d));

    /// <summary>
    ///     Points every document's events at the local bridge. Process-wide because one Rhino
    ///     process serves one bridge session. The bridge sets it when the WebSocket server starts
    ///     and clears it (null) before the socket closes.
    /// </summary>
    public static void SetLocalTransport(Action<SolveEvent> send) => _localTransport = send;

    internal static Action<SolveEvent> LocalTransport => _localTransport;
}
