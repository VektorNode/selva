#nullable enable
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Who may talk to the bridge. Any web page in the user's browser can open a socket to
///     localhost, so a page gets in only if this component's own web server (or the dev server)
///     served it and it knows the secret the plugin put in its URL fragment.
/// </summary>
internal static class BridgeAccess
{
    /// <summary>
    ///     The first message on every socket: <c>{"type":"authenticate","secret":"…"}</c>, plus
    ///     <c>"host":"rhino"</c> from the Rhino panel.
    /// </summary>
    public const string AuthenticateType = "authenticate";

    /// <summary>
    ///     The only host a page may declare. Only that socket may ask for a native file dialog, so a
    ///     browser tab on the same bridge can't open one inside Rhino. This is routing, not a
    ///     boundary: the secret is the boundary, and every holder of it is the user's own page.
    /// </summary>
    public const string PanelHost = "rhino";

    /// <summary>
    ///     Sent to that one socket once it has authenticated; the page waits for it before sending.
    ///     It carries the session's role, read when the socket authenticates, so a page reloaded
    ///     after Edit in Grasshopper learns it is now an author.
    /// </summary>
    public static string AuthenticatedMessage(BridgeRole role) =>
        "{\"type\":\"authenticated\",\"role\":\"" + RoleName(role) + "\"}";

    public static string RoleName(BridgeRole role) => role == BridgeRole.Player ? "player" : "author";

    /// <summary>
    ///     Close code for a socket that failed to authenticate, from the 4000–4999 range RFC 6455
    ///     leaves to applications. The page reads it as "reopen from Grasshopper" and stops retrying.
    /// </summary>
    public const int UnauthorizedCloseCode = 4401;

    public const int MaxAuthenticateBytes = 1024;

    /// <summary>32 random bytes, URL-safe base64 without padding.</summary>
    public static string NewSecret()
    {
        var bytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }

        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    /// <summary>
    ///     The secret rides in the fragment, which the browser never sends to a server or puts in a
    ///     Referer; the page moves it into sessionStorage. <paramref name="host" /> names the page's
    ///     host when it isn't a browser tab (<c>rhino</c> for the Rhino panel).
    /// </summary>
    /// <param name="role">
    ///     A player session's URL says so, so the page's first paint has no builder. The page only
    ///     renders this; the bridge enforces the role it acknowledges with.
    /// </param>
    public static string SessionUrl(string baseUrl, string sessionId, int wsPort, string secret,
        string? host = null, BridgeRole role = BridgeRole.Author)
    {
        var hostParam = host == null ? "" : $"&host={Uri.EscapeDataString(host)}";
        var modeParam = role == BridgeRole.Player ? "&mode=player" : "";
        return $"{baseUrl}/?session={Uri.EscapeDataString(sessionId)}&wsPort={wsPort}{hostParam}{modeParam}" +
               $"#s={Uri.EscapeDataString(secret)}";
    }

    public static IReadOnlyList<string> LoopbackOrigins(int port)
    {
        return new[] { $"http://localhost:{port}", $"http://127.0.0.1:{port}" };
    }

    /// <summary>Browsers always send Origin on a WebSocket upgrade, so a missing one is refused.</summary>
    public static bool IsAllowedOrigin(string? origin, IReadOnlyCollection<string> allowedOrigins)
    {
        if (string.IsNullOrEmpty(origin))
        {
            return false;
        }

        foreach (var allowed in allowedOrigins)
        {
            if (string.Equals(origin, allowed, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Stops DNS rebinding: a rebound name reaches 127.0.0.1, but the browser still sends that name.</summary>
    public static bool IsAllowedHost(string? host, int port)
    {
        if (string.IsNullOrEmpty(host))
        {
            return false;
        }

        foreach (var allowed in LoopbackHosts(port))
        {
            if (string.Equals(host, allowed, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static string[] LoopbackHosts(int port)
    {
        return new[] { $"localhost:{port}", $"127.0.0.1:{port}" };
    }

    /// <param name="host">Null for a browser tab, <see cref="PanelHost" /> for the Rhino panel.</param>
    public static bool TryAuthenticate(string message, string secret, out string? host)
    {
        host = null;

        JObject envelope;
        try
        {
            envelope = JObject.Parse(message);
        }
        catch (JsonException)
        {
            return false;
        }

        if (envelope["type"]?.Type != JTokenType.String ||
            (string?)envelope["type"] != AuthenticateType ||
            envelope["secret"]?.Type != JTokenType.String)
        {
            return false;
        }

        var declaredHost = envelope["host"];
        if (declaredHost != null && declaredHost.Type != JTokenType.Null &&
            (declaredHost.Type != JTokenType.String || (string?)declaredHost != PanelHost))
        {
            return false;
        }

        var presented = (string?)envelope["secret"];
        if (string.IsNullOrEmpty(presented) || !FixedTimeEquals(presented!, secret))
        {
            return false;
        }

        host = declaredHost?.Type == JTokenType.String ? PanelHost : null;
        return true;
    }

    /// <summary>
    ///     The messages a role may not send. Only these write the schema (`requestSyncPreview` only
    ///     reads), and the Selva commands upload it. The player commands mean nothing to an author.
    /// </summary>
    public static bool IsRefused(InboundKind kind, BridgeRole role)
    {
        switch (kind)
        {
            case InboundKind.SaveSchema:
            case InboundKind.ApplySyncChanges:
            case InboundKind.SelvaGetAccount:
            case InboundKind.SelvaConnect:
            case InboundKind.SelvaSignIn:
            case InboundKind.SelvaUseApiKey:
            case InboundKind.SelvaSignOut:
            case InboundKind.SelvaListTargets:
            case InboundKind.SelvaUpload:
            case InboundKind.SelvaCancel:
                return role == BridgeRole.Player;
            case InboundKind.CloseDefinition:
            case InboundKind.EditInGrasshopper:
                return role != BridgeRole.Player;
            default:
                return false;
        }
    }

    // CryptographicOperations.FixedTimeEquals isn't in net48.
    private static bool FixedTimeEquals(string presented, string expected)
    {
        var a = Encoding.UTF8.GetBytes(presented);
        var b = Encoding.UTF8.GetBytes(expected);
        var diff = a.Length ^ b.Length;
        for (var i = 0; i < a.Length && i < b.Length; i++)
        {
            diff |= a[i] ^ b[i];
        }

        return diff == 0;
    }
}

/// <summary>
///     What a session may do. An author session started from the canvas and may edit the schema.
///     A player session started from the Selva panel: it sets values, and nothing it sends may
///     write the schema back.
/// </summary>
public enum BridgeRole
{
    Author,
    Player
}
