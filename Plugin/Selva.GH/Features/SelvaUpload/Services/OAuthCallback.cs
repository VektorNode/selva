#nullable enable
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Selva.GH.Features.SelvaUpload.Services;

public enum OAuthCallbackKind
{
    Code,
    Cancelled,
    Failed
}

public sealed class OAuthCallbackResult
{
    public OAuthCallbackKind Kind { get; private set; }
    public string? Code { get; private set; }

    /// <summary>
    ///     False when the state didn't match: anything on this machine can request the callback
    ///     URL, so such a request is answered and ignored rather than allowed to end the sign-in.
    /// </summary>
    public bool FromThisSignIn { get; private set; } = true;

    /// <summary>Written by the plugin, never copied from the request.</summary>
    public string? Error { get; private set; }

    internal static OAuthCallbackResult Ok(string code) =>
        new() { Kind = OAuthCallbackKind.Code, Code = code };

    internal static OAuthCallbackResult Cancelled() =>
        new() { Kind = OAuthCallbackKind.Cancelled, Error = "Sign-in was cancelled." };

    internal static OAuthCallbackResult Failed(string error) =>
        new() { Kind = OAuthCallbackKind.Failed, Error = error };

    internal static OAuthCallbackResult Foreign() =>
        new()
        {
            Kind = OAuthCallbackKind.Failed,
            Error = "The sign-in answer didn't belong to this sign-in. Try again.",
            FromThisSignIn = false
        };
}

/// <summary>
///     The authorization request the plugin opens in the browser, and the redirect that comes back
///     to its loopback listener. The plugin is Selva's built-in public client: no secret, PKCE
///     instead, and a redirect that can only reach this machine.
/// </summary>
public static class OAuthCallback
{
    public const string ClientId = "selva-grasshopper";
    public const string CallbackPath = "/callback";

    public static string AuthorizeUrl(string authorizationEndpoint, string redirectUri, string codeChallenge,
        string state, string resource)
    {
        var separator = authorizationEndpoint.Contains("?") ? "&" : "?";
        return authorizationEndpoint + separator + string.Join("&", new[]
        {
            "response_type=code",
            "client_id=" + Uri.EscapeDataString(ClientId),
            "redirect_uri=" + Uri.EscapeDataString(redirectUri),
            "code_challenge=" + Uri.EscapeDataString(codeChallenge),
            "code_challenge_method=S256",
            "state=" + Uri.EscapeDataString(state),
            "scope=upload",
            "resource=" + Uri.EscapeDataString(resource)
        });
    }

    /// <summary>
    ///     Null when the request isn't for the callback path (a browser also asks for favicon.ico).
    ///     Checks state before anything else: until it matches, the request may not come from this
    ///     sign-in at all. Then the issuer (RFC 9207), so a code from another Selva can't be mixed in.
    /// </summary>
    public static OAuthCallbackResult? Parse(string requestTarget, string expectedState, string expectedIssuer)
    {
        var queryStart = requestTarget.IndexOf('?');
        var path = queryStart < 0 ? requestTarget : requestTarget.Substring(0, queryStart);
        if (path != CallbackPath)
        {
            return null;
        }

        var query = ParseQuery(queryStart < 0 ? string.Empty : requestTarget.Substring(queryStart + 1));
        if (query == null)
        {
            return OAuthCallbackResult.Failed("The sign-in answer was malformed. Try again.");
        }

        query.TryGetValue("state", out var state);
        if (!Pkce.FixedTimeEquals(state, expectedState))
        {
            return OAuthCallbackResult.Foreign();
        }

        query.TryGetValue("iss", out var issuer);
        if (issuer != expectedIssuer)
        {
            return OAuthCallbackResult.Failed("The sign-in answer came from a different Selva instance.");
        }

        if (query.TryGetValue("error", out var error))
        {
            return error == "access_denied"
                ? OAuthCallbackResult.Cancelled()
                : OAuthCallbackResult.Failed($"Selva refused the sign-in ({SafeErrorCode(error)}).");
        }

        if (!query.TryGetValue("code", out var code) || string.IsNullOrEmpty(code))
        {
            return OAuthCallbackResult.Failed("The sign-in answer had no code. Try again.");
        }

        return OAuthCallbackResult.Ok(code);
    }

    // A parameter given twice is refused rather than guessed at (RFC 6749 §3.1).
    private static Dictionary<string, string>? ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in query.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            var name = Decode(eq < 0 ? pair : pair.Substring(0, eq));
            var value = eq < 0 ? string.Empty : Decode(pair.Substring(eq + 1));
            if (result.ContainsKey(name))
            {
                return null;
            }

            result[name] = value;
        }

        return result;
    }

    private static string Decode(string value)
    {
        return Uri.UnescapeDataString(value.Replace('+', ' '));
    }

    // OAuth error codes are lowercase words; anything else is shown as "unknown".
    private static string SafeErrorCode(string error)
    {
        return Regex.IsMatch(error, "^[a-z_]{1,40}$") ? error : "unknown error";
    }
}
