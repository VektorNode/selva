using System.Collections.Generic;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

// ============================================================================
// Inbound message kinds
// ============================================================================

/// <summary>
///     Classification of a parsed inbound WebSocket message. Parsing/classifying is pure and testable
///     (<see cref="InboundMessageParser" />); dispatch (event raising and thread marshalling) lives
///     in <see cref="WebSocketTransport" />. Failure paths that used to be swallowed warnings (session
///     mismatch, malformed envelope, unknown type, missing required field) are named outcomes here.
/// </summary>
public enum InboundKind
{
    /// <summary>`valueUpdate` with a non-null `values` map.</summary>
    ValueUpdate,

    /// <summary>`requestCurrentValues`: no payload.</summary>
    RequestCurrentValues,

    /// <summary>`requestInitialData`: establishes the session; exempt from the session-id check.</summary>
    RequestInitialData,

    /// <summary>`saveSchema` with a non-null schema.</summary>
    SaveSchema,

    /// <summary>`requestSyncPreview` with a non-null schema.</summary>
    RequestSyncPreview,

    /// <summary>`applySyncChanges` with a non-null changes list.</summary>
    ApplySyncChanges,

    /// <summary>A known type whose `sessionId` didn't match (and isn't `requestInitialData`).</summary>
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
///     carries them; the rest are null. Rhino/GH-free POCO, links into the test project.
/// </summary>
public sealed class InboundMessage
{
    public InboundKind Kind { get; init; }

    /// <summary>Raw `type` from the envelope; null for <see cref="InboundKind.Malformed" />.</summary>
    public string MessageType { get; init; }

    public Dictionary<string, object> Values { get; init; }

    public UISchema Schema { get; init; }

    /// <summary>`saveSchema` base hash; may be null/empty, the conflict check tolerates that.</summary>
    public string BaseSchemaHash { get; init; }

    public List<SyncChange> Changes { get; init; }

    // Populated per-Kind, so most instances leave several of these null. The plugin compiles
    // without a nullable context; the test project links this file in under one, hence the
    // expected CS8618 "uninitialized" warnings there.

    public static InboundMessage Of(InboundKind kind, string messageType) =>
        new InboundMessage { Kind = kind, MessageType = messageType };
}
