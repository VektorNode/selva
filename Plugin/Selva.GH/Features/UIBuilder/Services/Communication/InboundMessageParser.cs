using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Parses and classifies a raw inbound WebSocket message into an <see cref="InboundMessage" />.
///     Pure logic over a JSON string: no sockets, no Rhino, no thread marshalling. The transport
///     (<see cref="WebSocketTransport" />) owns the socket and the UI-thread hop; this owns
///     interpreting the bytes, unit-tested instead of only checkable on a live canvas.
/// </summary>
public sealed class InboundMessageParser
{
    private readonly JsonSerializer _serializer;

    /// <param name="serializer">
    ///     Binds nested payloads (`values`, `schema`, `changes`). The transport passes its secure
    ///     serializer so binding rules match production; tests pass an equivalent one.
    /// </param>
    public InboundMessageParser(JsonSerializer serializer)
    {
        _serializer = serializer ?? throw new ArgumentNullException(nameof(serializer));
    }

    /// <summary>
    ///     Never throws on bad input: malformed JSON, a missing `type`, a session mismatch, or a
    ///     missing required field each map to a named <see cref="InboundKind" />.
    /// </summary>
    /// <param name="message">The raw text frame.</param>
    /// <param name="expectedSessionId">The session this transport is bound to.</param>
    public InboundMessage Parse(string message, string expectedSessionId)
    {
        JObject jObj;
        try
        {
            jObj = JObject.Parse(message);
        }
        catch (JsonException)
        {
            return InboundMessage.Of(InboundKind.Malformed, null);
        }

        var msgType = jObj["type"]?.ToString();
        if (string.IsNullOrEmpty(msgType))
        {
            return InboundMessage.Of(InboundKind.Malformed, null);
        }

        var sid = jObj["sessionId"]?.ToString();

        // requestInitialData establishes the session: exempt from the session check.
        if (msgType != "requestInitialData" && sid != expectedSessionId)
        {
            return InboundMessage.Of(InboundKind.SessionMismatch, msgType);
        }

        try
        {
            switch (msgType)
            {
                case "valueUpdate":
                    {
                        var values = jObj["values"]?.ToObject<Dictionary<string, object>>(_serializer);
                        if (values == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.ValueUpdate,
                            MessageType = msgType,
                            Values = values
                        };
                    }

                case "requestCurrentValues":
                    return InboundMessage.Of(InboundKind.RequestCurrentValues, msgType);

                case "requestInitialData":
                    return InboundMessage.Of(InboundKind.RequestInitialData, msgType);

                case "saveSchema":
                    {
                        var schema = jObj["schema"]?.ToObject<UISchema>(_serializer);
                        if (schema == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.SaveSchema,
                            MessageType = msgType,
                            Schema = schema,
                            BaseSchemaHash = jObj["baseSchemaHash"]?.ToString()
                        };
                    }

                case "requestSyncPreview":
                    {
                        var schema = jObj["schema"]?.ToObject<UISchema>(_serializer);
                        if (schema == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.RequestSyncPreview,
                            MessageType = msgType,
                            Schema = schema
                        };
                    }

                case "applySyncChanges":
                    {
                        var changes = jObj["changes"]?.ToObject<List<SyncChange>>(_serializer);
                        if (changes == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.ApplySyncChanges,
                            MessageType = msgType,
                            Changes = changes
                        };
                    }

                default:
                    return InboundMessage.Of(InboundKind.Unknown, msgType);
            }
        }
        catch (JsonException)
        {
            // A payload that's present but doesn't bind to its target type (wrong shape) is a
            // contract violation, not a crash: surface it as a missing/invalid field.
            return InboundMessage.Of(InboundKind.MissingField, msgType);
        }
    }
}
