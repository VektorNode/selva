using System;
using System.IO;

namespace Selva.Grasshopper.Config;

public static class AppConfig
{
	// WebSocket Configuration
	public static class WebSocket
	{
		public const int DefaultPort = 8765;
		public const int PortRangeMin = 8765;
		public const int PortRangeMax = 8865;
		public const int PortDiscoveryAttempts = 100;
		public const int MaxMessageSizeBytes = ValueLimits.MaxBase64StringLength; // Use the calculated base64 limit
		public const int BufferSizeBytes = 1024 * 1024; // 1MB buffer for faster large message reads
		public const int MaxConcurrentClients = 10;
		public const int HeartbeatIntervalMs = 30000; // 30 seconds
		public const int BroadcastTimeoutMs = 30000; // 30 seconds for large file uploads
		public const int ClientCloseTimeoutMs = 1000; // 1 second
		public const int PingTimeoutMs = 5000; // 5 seconds
		public const int ServerStartupTimeoutMs = 5000; // 5 seconds
		public const int ReceiveTimeoutMs = 120000; // 2 minutes for large file uploads
	}

	// HTTP Server Configuration
	public static class HttpServer
	{
		public const int BufferSizeBytes = 64 * 1024; // 64KB for file transfers
		public const string EmbeddedResourcePrefix = "Selva.EmbeddedAssets.web.";
		public const int PortRangeMin = 8000;
		public const int PortRangeMax = 9000;
		public const int PortDiscoveryAttempts = 100;
	}

	// Component Lifecycle
	public static class ComponentLifecycle
	{
		public const int ScheduleSolutionDelayMs = 10;
		public const int SchemaCleanupBroadcastTimeoutMs = 100;
	}

	// Value Constraints
	public static class ValueLimits
	{
		public const int MaxStringLength = 100000; // 100KB for regular strings
		public const int MaxFileSizeMB = 150;
		public const int MaxFileSizeBytes = MaxFileSizeMB * 1024 * 1024;

		// Base64 encoding adds ~33% overhead. We use a 1.5x multiplier to be safe and account for JSON wrapping/headers.
		// This ensures the limit scales automatically if MaxFileSizeMB is changed.
		public const int MaxBase64StringLength = MaxFileSizeBytes + (MaxFileSizeBytes / 2);

		// Threshold for switching from in-memory to streaming operations
		public const int StreamingThresholdBytes = 10 * 1024 * 1024; // 10MB
	}

	// Session Management
	public static class Sessions
	{
		public const int SessionIdLength = 8;
	}

	// File I/O
	public static class FileIO
	{
		public const int FileCopyBufferSizeBytes = 1024 * 1024; // 1MB
		private const string TempFolderName = "Selva";
		public static string TempDirectory => Path.Combine(Path.GetTempPath(), TempFolderName);
	}

	// JSON Serialization
	public static class JsonSerialization
	{
		public const int MaxJsonDepth = 32;
	}

	/// <summary>
	///   Configuration options for RhinoDocumentConverter
	/// </summary>
	public class RhinoConverterOptions
	{


		/// <summary>
		///   Threshold for switching to streaming conversion (default: 10MB)
		/// </summary>
		public long InMemoryThresholdBytes { get; set; } = ValueLimits.StreamingThresholdBytes;

		/// <summary>
		///   Maximum number of concurrent conversions (default: 4)
		/// </summary>
		public int MaxConcurrentConversions { get; set; } = 4;

		/// <summary>
		///   Timeout for waiting in conversion queue (default: 30 seconds)
		/// </summary>
		public TimeSpan ConversionTimeout { get; set; } = TimeSpan.FromSeconds(30);

		/// <summary>
		///   Whether to securely overwrite files before deletion (default: false)
		///   Use only for sensitive data - impacts performance
		/// </summary>
		public bool SecureDelete { get; set; } = false;
	}
}
