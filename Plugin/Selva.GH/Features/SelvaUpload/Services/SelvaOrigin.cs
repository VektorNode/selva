#nullable enable
using System;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     A Selva instance is identified by its origin: tokens are stored per origin, sent only to it,
///     and the OAuth issuer must equal it.
/// </summary>
public static class SelvaOrigin
{
    /// <summary>
    ///     Reduces what the user typed to <c>scheme://host[:port]</c>, lowercase, the host in
    ///     punycode. Plain http is allowed on loopback only: off loopback the key would cross the
    ///     network in clear.
    /// </summary>
    public static bool TryNormalize(string? input, out string? origin, out string? error)
    {
        origin = null;
        error = null;

        var text = (input ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            error = "Enter the address of your Selva instance.";
            return false;
        }

        if (!text.Contains("://"))
        {
            text = "https://" + text;
        }

        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host))
        {
            error = "That isn't a web address.";
            return false;
        }

        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
        {
            error = "Selva is reached over https.";
            return false;
        }

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            error = "Leave the user name and password out of the address.";
            return false;
        }

        if (uri.Scheme == Uri.UriSchemeHttp && !IsLoopbackHost(uri.Host))
        {
            error = "Use https. Over http, your Selva key would cross the network unencrypted.";
            return false;
        }

        origin = Compose(uri);
        return true;
    }

    /// <summary>What the user sees: the origin without its scheme.</summary>
    public static string DisplayHost(string origin)
    {
        var start = origin.IndexOf("://", StringComparison.Ordinal);
        return start < 0 ? origin : origin.Substring(start + 3);
    }

    /// <summary>True when <paramref name="url" /> is absolute and has exactly this scheme, host and port.</summary>
    public static bool IsOnOrigin(string? url, string origin)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) &&
               string.IsNullOrEmpty(uri.UserInfo) &&
               Compose(uri) == origin;
    }

    public static bool IsLoopbackHost(string host)
    {
        return host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    }

    private static string Compose(Uri uri)
    {
        // IdnHost drops IPv6 brackets.
        var host = uri.HostNameType == UriHostNameType.IPv6 ? uri.Host : uri.IdnHost;
        var port = uri.IsDefaultPort ? string.Empty : ":" + uri.Port;
        return $"{uri.Scheme}://{host.ToLowerInvariant()}{port}";
    }
}
