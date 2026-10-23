using System.Collections.Generic;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

// ============================================================================
// Inbound message kinds
// ============================================================================

/// <summary>
///     Classification of a parsed inbound WebSocket message. Parsing/classifying is pure and testable
///     (<see cref="InboundMessageParser" />); dispatch — event raising and thread marshalling — lives
///     in <see cref="WebSocketTransport" />. Failure paths that used to be swallowed warnings (session
///     mismatch, malformed envelope, unknown type, missing required field) are named outcomes here.
/// </summary>
public enum InboundKind
{
    /// <summary>`valueUpdate` with a non-null `values` map.</summary>
    ValueUpdate,

    /// <summary>`requestCurrentValues` — no payload.</summary>
    RequestCurrentValues,

    /// <summary>`requestInitialData` — no payload.</summary>
    RequestInitialData,

    /// <summary>`saveSchema` with a non-null schema.</summary>
    SaveSchema,

    /// <summary>`requestSyncPreview` with a non-null schema.</summary>
    RequestSyncPreview,

    /// <summary>`applySyncChanges` with a non-null changes list.</summary>
    ApplySyncChanges,

    /// <summary>`cancelSolve` — no payload. Handled off the UI thread, which the solver holds.</summary>
    CancelSolve,

    /// <summary>`selvaGetAccount` — no payload. Answered with `selvaAccount`.</summary>
    SelvaGetAccount,

    /// <summary>`selvaConnect` with the instance URL the user typed, not yet normalised.</summary>
    SelvaConnect,

    /// <summary>`selvaSignIn` — no payload. Starts the browser sign-in for the active instance.</summary>
    SelvaSignIn,

    /// <summary>`selvaUseApiKey` — no payload. The key is pasted into a plugin dialog, never the page.</summary>
    SelvaUseApiKey,

    /// <summary>`selvaSignOut` — no payload.</summary>
    SelvaSignOut,

    /// <summary>`selvaListTargets` — no payload. Answered with `selvaTargets`.</summary>
    SelvaListTargets,

    /// <summary>`selvaUpload` with a request whose kind and makeLive are present.</summary>
    SelvaUpload,

    /// <summary>`selvaCancel` — no payload. Stops a sign-in or upload in flight.</summary>
    SelvaCancel,

    /// <summary>`hostSaveFile` with a request id and file name. Only valid as a binary frame's header.</summary>
    HostSaveFile,

    /// <summary>`hostPickFile` with a request id and the page's accept list. Answered with one file or a result.</summary>
    HostPickFile,

    /// <summary>A message whose `sessionId` didn't match this transport's.</summary>
    SessionMismatch,

    /// <summary>A known type missing a required field (e.g. `valueUpdate` with no `values`).</summary>
    MissingField,

    /// <summary>A well-formed envelope with a `type` this transport doesn't handle.</summary>
    Unknown,

    /// <summary>Not valid JSON, or had no `type`.</summary>
    Malformed
}

/// <summary>
///     A parsed, classified inbound message. Payload fields are populated only for the kind that
///     carries them; the rest are null. Rhino/GH-free POCO — links into the test project.
/// </summary>
public sealed class InboundMessage
{
    public InboundKind Kind { get; init; }

    /// <summary>Raw `type` from the envelope; null for <see cref="InboundKind.Malformed" />.</summary>
    public string MessageType { get; init; }

    public Dictionary<string, object> Values { get; init; }

    public UISchema Schema { get; init; }

    /// <summary>`saveSchema` base hash; may be null/empty — the conflict check tolerates that.</summary>
    public string BaseSchemaHash { get; init; }

    public List<SyncChange> Changes { get; init; }

    public string Origin { get; init; }

    public SelvaUploadRequest UploadRequest { get; init; }

    /// <summary>Echoed in the reply so the page can match it to its request.</summary>
    public string RequestId { get; init; }

    /// <summary>The name to suggest in the Save dialog: a bare file name, never a path.</summary>
    public string FileName { get; init; }

    public List<string> Accept { get; init; }

    // Populated per-Kind, so most instances leave several of these null. The plugin compiles
    // without a nullable context; the test project links this file in under one, hence the
    // expected CS8618 "uninitialized" warnings there.

    public static InboundMessage Of(InboundKind kind, string messageType) =>
        new InboundMessage { Kind = kind, MessageType = messageType };
}
