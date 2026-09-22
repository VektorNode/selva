using System.IO;

namespace Selva.GH.Config;

public static class AppConfig
{
    // -------------------------------------------------------------------------
    // WebSocket
    // -------------------------------------------------------------------------
    public static class WebSocket
    {
        public const int DefaultPort = 8765;
        public const int MaxMessageSizeBytes = ValueLimits.MaxBase64StringLength;
        public const int BufferSizeBytes = 1024 * 1024; // 1 MB: faster large-message reads
        public const int MaxConcurrentClients = 10;
        public const int HeartbeatIntervalMs = 30_000; // 30 s
        public const int BroadcastTimeoutMs = 30_000; // 30 s: covers large file uploads
        public const int ClientCloseTimeoutMs = 1_000; //  1 s
        public const int PingTimeoutMs = 5_000; //  5 s
        public const int ServerStartupTimeoutMs = 5_000; //  5 s
        public const int ReceiveTimeoutMs = 120_000; // 2 min: covers large file uploads
    }

    // -------------------------------------------------------------------------
    // HTTP Server
    // -------------------------------------------------------------------------
    public static class HttpServer
    {
        public const int BufferSizeBytes = 64 * 1024; // 64 KB: file transfers
        public const string EmbeddedResourcePrefix = "Selva.EmbeddedAssets.web.";
    }

    // -------------------------------------------------------------------------
    // Component Lifecycle
    // -------------------------------------------------------------------------
    public static class ComponentLifecycle
    {
        public const int ScheduleSolutionDelayMs = 10;
        public const int SchemaCleanupBroadcastTimeoutMs = 100;
    }

    // -------------------------------------------------------------------------
    // UI Builder
    // -------------------------------------------------------------------------
    public static class UIBuilder
    {
        // Lets Grasshopper finish its current solution before output data is read.
        public const int InitialOutputBroadcastDelayMs = 100;
    }

    // -------------------------------------------------------------------------
    // Value Constraints
    // -------------------------------------------------------------------------
    public static class ValueLimits
    {
        public const int MaxStringLength = 100_000; // 100 KB for regular strings
        public const int MaxFileSizeMB = 150;
        public const int MaxFileSizeBytes = MaxFileSizeMB * 1024 * 1024;

        // Base64 adds ~33 % overhead; 1.5x gives headroom for JSON wrapping and headers.
        // Scales automatically when MaxFileSizeMB changes.
        public const int MaxBase64StringLength = MaxFileSizeBytes + MaxFileSizeBytes / 2;

        public const int StreamingThresholdBytes = 10 * 1024 * 1024; // 10 MB
    }

    // -------------------------------------------------------------------------
    // Session Management
    // -------------------------------------------------------------------------
    public static class Sessions
    {
        public const int SessionIdLength = 8;
    }

    // -------------------------------------------------------------------------
    // File I/O
    // -------------------------------------------------------------------------
    public static class FileIO
    {
        public const int FileCopyBufferSizeBytes = 1024 * 1024; // 1 MB

        // Evaluated once at startup: Path.GetTempPath() is stable for the process lifetime.
        public static readonly string TempDirectory =
            Path.Combine(Path.GetTempPath(), "Selva");
    }

    // -------------------------------------------------------------------------
    // JSON Serialization
    // -------------------------------------------------------------------------
    public static class JsonSerialization
    {
        public const int MaxJsonDepth = 32;
    }
}
