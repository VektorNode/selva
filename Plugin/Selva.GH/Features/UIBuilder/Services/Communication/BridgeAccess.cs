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
    /// <summary>The first message on every socket: <c>{"type":"authenticate","secret":"…"}</c>.</summary>
    public const string AuthenticateType = "authenticate";

    /// <summary>Sent to that one socket once it has authenticated; the page waits for it before sending.</summary>
    public const string AuthenticatedMessage = "{\"type\":\"authenticated\"}";

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
    ///     Referer; the page moves it into sessionStorage.
    /// </summary>
    public static string SessionUrl(string baseUrl, string sessionId, int wsPort, string secret)
    {
        return $"{baseUrl}/?session={Uri.EscapeDataString(sessionId)}&wsPort={wsPort}" +
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

    public static bool IsValidAuthenticate(string message, string secret)
    {
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

        var presented = (string?)envelope["secret"];
        return !string.IsNullOrEmpty(presented) && FixedTimeEquals(presented!, secret);
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
