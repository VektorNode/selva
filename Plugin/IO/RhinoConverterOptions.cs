using System;

namespace Compuceraptor.Components.IO;

/// <summary>
/// Configuration options for RhinoDocumentConverter
/// </summary>
public class RhinoConverterOptions
{
    /// <summary>
    /// Maximum file size allowed (default: 100MB)
    /// </summary>
    public long MaxFileSizeBytes { get; set; } = 100 * 1024 * 1024;

    /// <summary>
    /// Threshold for switching to streaming conversion (default: 10MB)
    /// </summary>
    public long InMemoryThresholdBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>
    /// Maximum number of concurrent conversions (default: 4)
    /// </summary>
    public int MaxConcurrentConversions { get; set; } = 4;

    /// <summary>
    /// Timeout for waiting in conversion queue (default: 30 seconds)
    /// </summary>
    public TimeSpan ConversionTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Whether to securely overwrite files before deletion (default: false)
    /// Use only for sensitive data - impacts performance
    /// </summary>
    public bool SecureDelete { get; set; } = false;
}