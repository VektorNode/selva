#nullable enable
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     The instance's OAuth metadata, accepted only when it describes this origin and nothing else:
///     the plugin opens the authorization endpoint in the system browser, so a URL from here must
///     never point at another host or another kind of link.
/// </summary>
public sealed class AuthServerMetadata
{
    public const string WellKnownPath = "/.well-known/oauth-authorization-server";

    private AuthServerMetadata(string authorizationEndpoint, string tokenEndpoint)
    {
        AuthorizationEndpoint = authorizationEndpoint;
        TokenEndpoint = tokenEndpoint;
    }

    public string AuthorizationEndpoint { get; }
    public string TokenEndpoint { get; }

    public static bool TryParse(string body, string origin, out AuthServerMetadata? metadata, out string? error)
    {
        metadata = null;
        error = null;

        JObject json;
        try
        {
            json = JObject.Parse(body);
        }
        catch (JsonException)
        {
            error = "This address doesn't answer like a Selva instance.";
            return false;
        }

        if ((string?)json["issuer"] != origin)
        {
            error = "This address doesn't answer like a Selva instance: it names a different issuer.";
            return false;
        }

        var authorize = json["authorization_endpoint"]?.Type == JTokenType.String
            ? (string?)json["authorization_endpoint"]
            : null;
        var token = json["token_endpoint"]?.Type == JTokenType.String ? (string?)json["token_endpoint"] : null;
        if (!SelvaOrigin.IsOnOrigin(authorize, origin) || !SelvaOrigin.IsOnOrigin(token, origin))
        {
            error = "This Selva instance names sign-in addresses outside its own site, so the plugin won't use them.";
            return false;
        }

        if (!Contains(json["code_challenge_methods_supported"], "S256"))
        {
            error = "This Selva instance doesn't support secure sign-in from apps (PKCE S256).";
            return false;
        }

        if (!Contains(json["scopes_supported"], "upload"))
        {
            error = "This Selva instance can't take uploads from the plugin yet. Ask its admin to update it.";
            return false;
        }

        metadata = new AuthServerMetadata(authorize!, token!);
        return true;
    }

    private static bool Contains(JToken? array, string value)
    {
        return array is JArray items && items.Any(i => i.Type == JTokenType.String && (string?)i == value);
    }
}
