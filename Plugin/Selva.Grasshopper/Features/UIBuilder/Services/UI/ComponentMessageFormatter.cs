using Selva.Core.Models;

namespace Selva.Grasshopper.Features.UIBuilder.Services.UI;

/// <summary>
///   Formats status messages for UI Builder component
/// </summary>
public static class ComponentMessageFormatter
{
	/// <summary>
	///   Create the Info output message showing session status
	/// </summary>
	public static string CreateInfoMessage(string sessionId, bool isEnabled, UISchema schema, bool isConnected,
		bool isHeadless = false)
	{
		var status = isEnabled
			? isHeadless ? "Headless Mode" : "Active (WebSocket)"
			: "Disabled";

		if (schema != null)
		{
			var inputCount = schema.Inputs?.Count ?? 0;
			var outputCount = schema.Outputs?.Count ?? 0;

			if (isEnabled)
			{
				if (isHeadless) return $"Session: {sessionId}\nStatus: {status}\nSchema loaded (no WebSocket)";

				if (inputCount == 0 && outputCount == 0)
					return
						$"Session: {sessionId}\nStatus: {status}\nWaiting for schema...\nSwitch to Build mode in web UI";

				return
					$"Session: {sessionId}\nStatus: {status}\nSchema: {inputCount} inputs, {outputCount} outputs\nSwitch modes in web UI";
			}

			return
				$"Session: {sessionId}\nStatus: {status}\nSchema: {inputCount} inputs, {outputCount} outputs (saved)\nSet Enable to true to start";
		}

		return isEnabled
			? $"Session: {sessionId}\nStatus: {status}\nNo schema yet"
			: $"Session: {sessionId}\nStatus: {status}\nNo schema yet\nSet Enable to true to start";
	}

	/// <summary>
	///   Create the component display message (shown on canvas)
	/// </summary>
	public static string CreateDisplayMessage(bool isEnabled, bool isConnected, UISchema schema, string sessionId)
	{
		if (!isEnabled) return schema != null ? "Offline" : "Offline • No Schema";

		if (!isConnected) return "Headless • No WebSocket";

		return $"Ready • {sessionId}";
	}

	/// <summary>
	///   Create error message for a specific context
	/// </summary>
	public static string CreateErrorInfoMessage(string context)
	{
		return $"ERROR: {context}";
	}
}
