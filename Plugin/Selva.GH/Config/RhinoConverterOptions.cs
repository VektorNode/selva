using System;

namespace Selva.GH.Config;

/// <summary>
///     Configuration options for RhinoDocumentConverter.
/// </summary>
public class RhinoConverterOptions
{
    /// <summary>
    ///     Threshold for switching to streaming conversion (default: 10 MB).
    /// </summary>
    public long InMemoryThresholdBytes { get; set; } = AppConfig.ValueLimits.StreamingThresholdBytes;

    /// <summary>
    ///     Maximum number of concurrent conversions (default: 4).
    /// </summary>
    public int MaxConcurrentConversions { get; set; } = 4;

    /// <summary>
    ///     Timeout for waiting in the conversion queue (default: 30 seconds).
    /// </summary>
    public TimeSpan ConversionTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    ///     Whether to securely overwrite files before deletion (default: false).
    ///     Use only for sensitive data — has a performance cost.
    /// </summary>
    public bool SecureDelete { get; set; } = false;
}
