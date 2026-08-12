using System;
using System.Security.Cryptography;
using Selva.GH.Config;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>Generates and validates the session ID used to pair a WebSocket connection to this document.</summary>
public class SessionManager
{
    public string CurrentSessionId { get; private set; }

    public string CreateNewSession()
    {
        CurrentSessionId = GenerateSessionId(AppConfig.Sessions.SessionIdLength);
        return CurrentSessionId;
    }

    public bool ValidateSession(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId))
        {
            return false;
        }

        if (string.IsNullOrEmpty(CurrentSessionId))
        {
            return false;
        }

        return sessionId == CurrentSessionId;
    }

    public void ClearSession()
    {
        CurrentSessionId = null;
    }

    /// <summary>Builds a URL-safe base64 session ID (+ and / replaced with - and _) of the given length.</summary>
    private static string GenerateSessionId(int length)
    {
        if (length <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(length), "Length must be > 0");
        }

        string EncodeUrlSafe(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        var id = EncodeUrlSafe(Guid.NewGuid().ToByteArray());

        while (id.Length < length)
        {
            var extra = new byte[12];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(extra);
            }

            id += EncodeUrlSafe(extra);
        }

        return id.Substring(0, length);
    }
}
