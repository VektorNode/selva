using System.Collections.Generic;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

// ============================================================================
// Inbound message kinds
// ============================================================================

/// <summary>
///     The classification of a parsed inbound WebSocket message. Splitting the parse/classify
///     (pure, testable — <see cref="InboundMessageParser" />) from the dispatch (event raising +
///     thread marshalling, which lives in <see cref="WebSocketTransport" />) is what makes the
///     wire-inbound contract unit-testable without a Grasshopper runtime. Every historically-silent
///     failure path — a session mismatch, a malformed envelope, an unknown type, a known type with a
///     missing required field — becomes a named outcome here instead of a swallowed warning.
/// </summary>
public enum InboundKind
{
    /// <summary>`valueUpdate` carrying a non-null `values` map. <see cref="InboundMessage.Values" />.</summary>
    ValueUpdate,

    /// <summary>`requestCurrentValues` — no payload.</summary>
    RequestCurrentValues,

    /// <summary>`requestInitialData` — establishes the session; exempt from the session-id check.</summary>
    RequestInitialData,

    /// <summary>`saveSchema` carrying a non-null schema. <see cref="InboundMessage.Schema" /> + <see cref="InboundMessage.BaseSchemaHash" />.</summary>
    SaveSchema,

    /// <summary>`requestSyncPreview` carrying a non-null schema. <see cref="InboundMessage.Schema" />.</summary>
    RequestSyncPreview,

    /// <summary>`applySyncChanges` carrying a non-null changes list. <see cref="InboundMessage.Changes" />.</summary>
    ApplySyncChanges,

    /// <summary>A known type whose `sessionId` did not match the session (and isn't `requestInitialData`).</summary>
    SessionMismatch,

    /// <summary>A known type that was missing a required field (e.g. `valueUpdate` with no `values`).</summary>
    MissingField,

    /// <summary>A well-formed envelope with a `type` this transport does not handle.</summary>
    Unknown,

    /// <summary>The message was not valid JSON, or had no `type`.</summary>
    Malformed
}

/// <summary>
///     A parsed, classified inbound message. The payload fields are populated only for the kind that
///     carries them; all others are null. Rhino/GH-free POCO — links into the test project.
/// </summary>
public sealed class InboundMessage
{
    public InboundKind Kind { get; init; }

    /// <summary>The raw `type` string from the envelope, when present (null for <see cref="InboundKind.Malformed" />).</summary>
    public string MessageType { get; init; }

    /// <summary>`valueUpdate` payload.</summary>
    public Dictionary<string, object> Values { get; init; }

    /// <summary>`saveSchema` / `requestSyncPreview` payload.</summary>
    public UISchema Schema { get; init; }

    /// <summary>`saveSchema` base hash (may be null/empty — the conflict check tolerates that).</summary>
    public string BaseSchemaHash { get; init; }

    /// <summary>`applySyncChanges` payload.</summary>
    public List<SyncChange> Changes { get; init; }

    // The fields above are optional facts; the plugin compiles without a nullable context, and the
    // test project links this file into a nullable-enabled context. Callers switch on Kind and read
    // only the field that kind populates, so the CS8618 "uninitialized" warnings are expected.

    public static InboundMessage Of(InboundKind kind, string messageType) =>
        new InboundMessage { Kind = kind, MessageType = messageType };
}
