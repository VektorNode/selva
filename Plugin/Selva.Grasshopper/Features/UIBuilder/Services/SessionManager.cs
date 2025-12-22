using System;
using System.Security.Cryptography;
using Selva.Grasshopper.Config;

namespace Selva.Grasshopper.Features.UIBuilder.Services;

/// <summary>
/// Manages session ID generation, validation, and tracking for WebSocket communication.
/// </summary>
public class SessionManager
{
	private string _currentSessionId;

	public string CurrentSessionId => _currentSessionId;

	public string CreateNewSession()
	{
		_currentSessionId = GenerateSessionId(AppConfig.Sessions.SessionIdLength);
		return _currentSessionId;
	}

	public bool ValidateSession(string sessionId)
	{
		if (string.IsNullOrEmpty(sessionId)) return false;
		if (string.IsNullOrEmpty(_currentSessionId)) return false;
		return sessionId == _currentSessionId;
	}

	public void ClearSession()
	{
		_currentSessionId = null;
	}

	/// <summary>
	/// Generates a cryptographically secure session ID.
	/// Uses URL-safe base64 encoding (replaces + and / with - and _).
	/// </summary>
	private static string GenerateSessionId(int length)
	{
		if (length <= 0) throw new ArgumentOutOfRangeException(nameof(length), "Length must be > 0");

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
