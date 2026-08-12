using System;

namespace Selva.GH.Config;

public class RhinoConverterOptions
{
    public long InMemoryThresholdBytes { get; set; } = AppConfig.ValueLimits.StreamingThresholdBytes;

    public int MaxConcurrentConversions { get; set; } = 4;

    public TimeSpan ConversionTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    ///     Securely overwrites files before deletion. Off by default — has a performance cost.
    /// </summary>
    public bool SecureDelete { get; set; } = false;
}
