using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.AppFormat;
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
            // The requestId rides along so a host file request can still be failed.
            return new InboundMessage
                { Kind = InboundKind.SessionMismatch, MessageType = msgType, RequestId = RequestIdOf(jObj) };
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
                    return new InboundMessage
                    {
                        Kind = InboundKind.RequestInitialData,
                        MessageType = msgType,
                        SchemaOnly = jObj["schemaOnly"]?.Type == JTokenType.Boolean && (bool)jObj["schemaOnly"]
                    };

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
                            return new InboundMessage
                                { Kind = InboundKind.MissingField, MessageType = msgType, RequestId = requestId };
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

                case "pickGeometry":
                    {
                        var requestId = RequestIdOf(jObj);
                        var paramId = ParamIdOf(jObj);
                        if (requestId == null || paramId == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = InboundKind.PickGeometry,
                            MessageType = msgType,
                            RequestId = requestId,
                            ParamId = paramId.Value
                        };
                    }

                case "clearGeometry":
                case "trigger":
                    {
                        var paramId = ParamIdOf(jObj);
                        if (paramId == null)
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        return new InboundMessage
                        {
                            Kind = msgType == "trigger" ? InboundKind.Trigger : InboundKind.ClearGeometry,
                            MessageType = msgType,
                            ParamId = paramId.Value
                        };
                    }

                case "closeDefinition":
                    return InboundMessage.Of(InboundKind.CloseDefinition, msgType);

                case "editInGrasshopper":
                    return InboundMessage.Of(InboundKind.EditInGrasshopper, msgType);

                case "draftLayout":
                    {
                        var placements = jObj["placements"];
                        if (placements?.Type == JTokenType.Null)
                        {
                            return new InboundMessage { Kind = InboundKind.DraftLayout, MessageType = msgType };
                        }

                        var locations = placements is JArray array ? DraftLocationsOf(array) : null;
                        return locations == null
                            ? InboundMessage.Of(InboundKind.MissingField, msgType)
                            : new InboundMessage { Kind = InboundKind.DraftLayout, MessageType = msgType, DraftLocations = locations };
                    }

                case "readLayout":
                    return new InboundMessage { Kind = InboundKind.ReadLayout, MessageType = msgType, RequestId = RequestIdOf(jObj) };

                case "applyLayout":
                    return jObj["spec"] is JObject spec
                        ? new InboundMessage
                        {
                            Kind = InboundKind.ApplyLayout,
                            MessageType = msgType,
                            RequestId = RequestIdOf(jObj),
                            LayoutSpec = spec.ToString(Formatting.None)
                        }
                        : InboundMessage.Of(InboundKind.MissingField, msgType);

                case "exportApp":
                    {
                        var requestId = RequestIdOf(jObj);
                        var name = jObj["name"]?.Type == JTokenType.String ? ((string)jObj["name"]).Trim() : null;

                        // A key of the wrong type is refused, not dropped: the app would go out unprotected.
                        var keyToken = jObj["key"];
                        var keyAbsent = keyToken == null || keyToken.Type == JTokenType.Null;
                        if (requestId == null || string.IsNullOrEmpty(name) ||
                            (!keyAbsent && keyToken.Type != JTokenType.String) ||
                            !TryReadAppIcon(jObj["icon"], out var icon))
                        {
                            return InboundMessage.Of(InboundKind.MissingField, msgType);
                        }

                        var key = keyAbsent ? null : (string)keyToken;
                        return new InboundMessage
                        {
                            Kind = InboundKind.ExportApp,
                            MessageType = msgType,
                            RequestId = requestId,
                            AppName = name,
                            AppKey = string.IsNullOrEmpty(key) ? null : key,
                            AppIcon = icon
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

    // First placement wins, as in LayoutPlacement.Locations. Null when any entry is malformed.
    private static Dictionary<Guid, LayoutPlacement.Location> DraftLocationsOf(JArray placements)
    {
        var locations = new Dictionary<Guid, LayoutPlacement.Location>();
        foreach (var token in placements)
        {
            if (token is not JObject placement
                || placement["paramId"]?.Type != JTokenType.String
                || !Guid.TryParse((string)placement["paramId"], out var id)
                || placement["groupLabel"]?.Type != JTokenType.String)
            {
                return null;
            }

            if (!locations.ContainsKey(id))
            {
                locations[id] = new LayoutPlacement.Location
                {
                    TabLabel = placement["tabLabel"]?.Type == JTokenType.String ? (string)placement["tabLabel"] : null,
                    GroupLabel = (string)placement["groupLabel"]
                };
            }
        }

        return locations;
    }

    private const int MaxRequestIdLength = 64;
    private const int MaxFileNameLength = 255;

    private static Guid? ParamIdOf(JObject jObj)
    {
        return jObj["paramId"]?.Type == JTokenType.String && Guid.TryParse((string)jObj["paramId"], out var id)
            ? id
            : null;
    }

    /// <summary>
    ///     An absent icon is fine. One that isn't a PNG of an accepted size refuses the whole
    ///     export, so an app never goes out quietly missing the icon its author picked.
    /// </summary>
    private static bool TryReadAppIcon(JToken token, out byte[] icon)
    {
        icon = null;
        if (token == null || token.Type == JTokenType.Null)
        {
            return true;
        }

        // Base64 is four characters per three bytes; checked first so nothing oversized is decoded.
        var text = token.Type == JTokenType.String ? (string)token : null;
        if (text == null || text.Length > AppFile.MaxIconBytes / 3 * 4 + 4)
        {
            return false;
        }

        try
        {
            icon = Convert.FromBase64String(text);
        }
        catch (FormatException)
        {
            return false;
        }

        return icon.Length <= AppFile.MaxIconBytes && AppFile.IsPng(icon);
    }

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
