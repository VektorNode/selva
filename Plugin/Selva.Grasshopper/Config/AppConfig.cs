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
		public const int MaxMessageSizeBytes = 10 * 1024 * 1024; // 10MB
		public const int BufferSizeBytes = 4096;
		public const int MaxConcurrentClients = 10;
		public const int HeartbeatIntervalMs = 30000; // 30 seconds
		public const int BroadcastTimeoutMs = 5000; // 5 seconds
		public const int ClientCloseTimeoutMs = 1000; // 1 second
		public const int PingTimeoutMs = 5000; // 5 seconds
		public const int ServerStartupTimeoutMs = 5000; // 5 seconds
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
		public const int MaxStringLength = 100000; // 100KB
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
		///   Maximum file size allowed (default: 100MB)
		/// </summary>
		public long MaxFileSizeBytes { get; set; } = 100 * 1024 * 1024;

		/// <summary>
		///   Threshold for switching to streaming conversion (default: 10MB)
		/// </summary>
		public long InMemoryThresholdBytes { get; set; } = 10 * 1024 * 1024;

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
