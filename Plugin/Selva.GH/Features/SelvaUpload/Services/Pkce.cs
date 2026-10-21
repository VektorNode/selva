#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>Proof key for the authorization code (RFC 7636, S256) and the request's state.</summary>
public static class Pkce
{
    public static string NewVerifier() => RandomToken();

    public static string NewState() => RandomToken();

    public static string Challenge(string verifier)
    {
        using var sha = SHA256.Create();
        return Base64Url(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier)));
    }

    /// <summary>Constant time, so a forged callback can't learn the state byte by byte.</summary>
    public static bool FixedTimeEquals(string? presented, string expected)
    {
        if (presented == null)
        {
            return false;
        }

        var a = Encoding.UTF8.GetBytes(presented);
        var b = Encoding.UTF8.GetBytes(expected);
        var diff = a.Length ^ b.Length;
        for (var i = 0; i < a.Length && i < b.Length; i++)
        {
            diff |= a[i] ^ b[i];
        }

        return diff == 0;
    }

    private static string RandomToken()
    {
        var bytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }

        return Base64Url(bytes);
    }

    private static string Base64Url(byte[] bytes)
    {
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
