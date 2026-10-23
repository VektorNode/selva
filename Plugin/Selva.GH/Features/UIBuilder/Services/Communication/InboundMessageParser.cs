using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Parses and classifies a raw inbound WebSocket message into an <see cref="InboundMessage" />.
///     Pure logic over a JSON string — no sockets, no Rhino, no thread marshalling. The transport
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
    ///     Never throws on bad input — malformed JSON, a missing `type`, a session mismatch, or a
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
        if (sid != expectedSessionId)
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

                case "cancelSolve":
                    return InboundMessage.Of(InboundKind.CancelSolve, msgType);

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

                case "selvaGetAccount":
                    return InboundMessage.Of(InboundKind.SelvaGetAccount, msgType);

                case "selvaConnect":
                    {
                        var origin = jObj["origin"]?.Type == JTokenType.String ? (string)jObj["origin"] : null;
                        if (string.IsNullOrWhiteSpace(origin))
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.SelvaConnect,
                            MessageType = msgType,
                            Origin = origin
                        };
                    }

                case "selvaSignIn":
                    return InboundMessage.Of(InboundKind.SelvaSignIn, msgType);

                case "selvaUseApiKey":
                    return InboundMessage.Of(InboundKind.SelvaUseApiKey, msgType);

                case "selvaSignOut":
                    return InboundMessage.Of(InboundKind.SelvaSignOut, msgType);

                case "selvaListTargets":
                    return InboundMessage.Of(InboundKind.SelvaListTargets, msgType);

                case "selvaUpload":
                    {
                        // makeLive is a plain bool once bound, so its presence is checked on the JSON.
                        var request = jObj["request"] as JObject;
                        var kind = request?["kind"]?.ToString();
                        if (request?["makeLive"]?.Type != JTokenType.Boolean ||
                            (kind != "newDefinition" && kind != "newVersion"))
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.SelvaUpload,
                            MessageType = msgType,
                            UploadRequest = request.ToObject<SelvaUploadRequest>(_serializer)
                        };
                    }

                case "selvaCancel":
                    return InboundMessage.Of(InboundKind.SelvaCancel, msgType);

                case "hostSaveFile":
                    {
                        var requestId = RequestIdOf(jObj);
                        var fileName = jObj["fileName"]?.Type == JTokenType.String
                            ? BareFileName((string)jObj["fileName"])
                            : null;
                        if (requestId == null || fileName == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.HostSaveFile,
                            MessageType = msgType,
                            RequestId = requestId,
                            FileName = fileName
                        };
                    }

                case "hostPickFile":
                    {
                        var requestId = RequestIdOf(jObj);
                        if (requestId == null || !(jObj["accept"] is JArray acceptArray))
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        var accept = new List<string>();
                        foreach (var entry in acceptArray)
                        {
                            if (entry.Type == JTokenType.String)
                            {
                                accept.Add((string)entry);
                            }
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.HostPickFile,
                            MessageType = msgType,
                            RequestId = requestId,
                            Accept = accept
                        };
                    }

                default:
                    return InboundMessage.Of(InboundKind.Unknown, msgType);
            }
        }
        catch (JsonException)
        {
            // A payload that's present but doesn't bind to its target type (wrong shape) is a
            // contract violation, not a crash — surface it as a missing/invalid field.
            return InboundMessage.Of(InboundKind.MissingField, msgType);
        }
    }

    private const int MaxRequestIdLength = 64;
    private const int MaxFileNameLength = 255;

    private static string RequestIdOf(JObject jObj)
    {
        var requestId = jObj["requestId"]?.Type == JTokenType.String ? (string)jObj["requestId"] : null;
        return string.IsNullOrEmpty(requestId) || requestId.Length > MaxRequestIdLength ? null : requestId;
    }

    // Both separators on every platform: Path.GetFileName on macOS keeps a backslash as part of
    // the name.
    private static string BareFileName(string fileName)
    {
        var name = fileName.Substring(fileName.LastIndexOfAny(new[] { '/', '\\' }) + 1).Trim();
        if (name.Length == 0 || name == "." || name == "..")
        {
            return "download";
        }

        return name.Length > MaxFileNameLength ? name.Substring(0, MaxFileNameLength) : name;
    }
}
