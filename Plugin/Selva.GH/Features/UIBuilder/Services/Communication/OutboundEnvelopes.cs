using System;
using System.Collections.Generic;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Builds the outbound WebSocket message envelopes — the JSON shapes the web UI reads. Pure:
///     given a session id and a payload, returns the object to serialize. No sockets, no Rhino, no
///     transport state (solving-state dedup, binary frames, the live <see cref="WebSocketServer" />
///     all stay in <see cref="WebSocketTransport" />).
///
///     This exists so the wire-outbound contract is unit-testable. The two rules that historically
///     drifted and broke the UI silently — both now enforced by tests in OutboundEnvelopesTests:
///     <list type="bullet">
///         <item>
///             <see cref="ParametersAdded" /> is FLAT (`availableParams` at the top level), because
///             the TS `WsParametersAddedMessage` reads it there. Wrapping it under `data:` made the
///             field undefined and forced a silent fallback round-trip.
///         </item>
///         <item>
///             <see cref="MetadataUpdated" />'s `changedParams` is a FLAT array keyed by parameter
///             id (inputs and outputs mixed). Sending the nested <see cref="DiscoveredParameters" />
///             object instead made the UI call `.forEach` on a non-array and throw.
///         </item>
///     </list>
///     The generic <see cref="Wrapped" /> envelope (`{ type, sessionId, data }`) is the opposite
///     convention — only for messages whose TS type reads `msg.data.&lt;field&gt;`.
/// </summary>
public static class OutboundEnvelopes
{
    /// <summary>
    ///     Generic envelope `{ type, sessionId, data }`. Use ONLY for messages whose TS type reads
    ///     fields under `msg.data.*`. Never for messages that read fields at the top level.
    /// </summary>
    public static object Wrapped(string sessionId, string messageType, object data) =>
        new { type = messageType, sessionId, data };

    /// <summary>
    ///     `parametersAdded` — FLAT: `availableParams` sits at the top level, matching
    ///     `WsParametersAddedMessage`.
    /// </summary>
    public static object ParametersAdded(string sessionId, DiscoveredParameters availableParams) =>
        new { type = "parametersAdded", sessionId, availableParams };

    public static object CurrentValues(string sessionId, Dictionary<string, object> values) =>
        new { type = "currentValues", sessionId, values };

    public static object SchemaUpdated(string sessionId, UISchema schema, string schemaHash,
        List<Guid> removedIds) =>
        new
        {
            type = "schemaUpdated",
            sessionId,
            schema,
            schemaHash,
            removedIds = removedIds ?? new List<Guid>()
        };

    public static object InitialData(string sessionId, UISchema schema, string schemaHash,
        DiscoveredParameters availableParams, Dictionary<string, object> currentValues, bool isSolving) =>
        new
        {
            type = "initialData",
            sessionId,
            schema,
            schemaHash,
            availableParams,
            currentValues,
            isSolving
        };

    public static object SchemaSaved(string sessionId, bool success, string message) =>
        new { type = "schemaSaved", sessionId, success, message };

    public static object SchemaSaveRejected(string sessionId, UISchema currentSchema, string schemaHash,
        string reason) =>
        new
        {
            type = "schemaSaveRejected",
            sessionId,
            schema = currentSchema,
            schemaHash,
            reason = reason ?? "Schema changed in Grasshopper since you started editing."
        };

    public static object SolvingState(string sessionId, bool isSolving) =>
        new { type = "solvingState", sessionId, isSolving };

    public static object RuntimeMessage(string sessionId, string level, string messageText,
        DateTime timestamp) =>
        new { type = "runtimeMessage", sessionId, level, message = messageText, timestamp };

    public static object SyncPreview(string sessionId, SyncDiff syncDiff) =>
        new { type = "syncPreview", sessionId, fromGH = syncDiff.FromGH, toGH = syncDiff.ToGH };

    public static object SyncApplied(string sessionId, bool success, string message) =>
        new
        {
            type = "syncApplied",
            sessionId,
            success,
            message = message ?? (success ? "Sync completed successfully" : "Sync failed")
        };

    /// <summary>
    ///     The `outputs` JSON envelope (the binary mesh frames that follow are sent separately by the
    ///     transport). `binaryBatchCount` tells the client how many binary frames to collect.
    /// </summary>
    public static object Outputs(string sessionId, Dictionary<string, object> outputs,
        Dictionary<string, object> fileOutputs, int binaryBatchCount, string modelUnits) =>
        new
        {
            type = "outputs",
            sessionId,
            outputs,
            fileOutputs,
            binaryBatchCount,
            modelUnits
        };

    /// <summary>
    ///     `metadataUpdated` — flattens a <see cref="DiscoveredParameters" /> into the FLAT array the
    ///     UI expects (inputs + outputs mixed, keyed by id). Returns null when there is nothing to
    ///     report, so the transport can skip the broadcast. Entries are dictionaries so absent
    ///     optional fields are simply not emitted — the UI's `!== undefined` checks require missing
    ///     keys, not explicit nulls.
    /// </summary>
    public static object MetadataUpdated(string sessionId, DiscoveredParameters changedParams)
    {
        if (changedParams == null)
        {
            return null;
        }

        var inputCount = changedParams.Inputs?.Count ?? 0;
        var outputCount = changedParams.Outputs?.Count ?? 0;
        if (inputCount == 0 && outputCount == 0)
        {
            return null;
        }

        var flat = new List<Dictionary<string, object>>(inputCount + outputCount);
        if (changedParams.Inputs != null)
        {
            foreach (var i in changedParams.Inputs)
            {
                var item = new Dictionary<string, object>
                {
                    ["id"] = i.Id,
                    ["nickname"] = i.Nickname,
                    ["description"] = i.Description ?? ""
                };
                if (i.Minimum.HasValue) item["minimum"] = i.Minimum.Value;
                if (i.Maximum.HasValue) item["maximum"] = i.Maximum.Value;
                if (i.StepSize.HasValue) item["stepSize"] = i.StepSize.Value;
                if (i.Options != null) item["options"] = i.Options;
                flat.Add(item);
            }
        }

        if (changedParams.Outputs != null)
        {
            foreach (var o in changedParams.Outputs)
            {
                flat.Add(new Dictionary<string, object>
                {
                    ["id"] = o.Id,
                    ["nickname"] = o.Nickname,
                    ["description"] = o.Description ?? ""
                });
            }
        }

        return new { type = "metadataUpdated", sessionId, changedParams = flat };
    }
}
