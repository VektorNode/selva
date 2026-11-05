using System;
using System.Threading;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     A cancel that arrived before its solve started. Grasshopper clears the abort flag as a
///     solution starts, so the cancel is held here and applied by the start itself. Armed from the
///     socket thread, consumed on the UI thread. Rhino-free.
/// </summary>
public sealed class AbortArm
{
    // Longer than any schedule delay, short enough that a solve which never started can't abort an
    // unrelated one that starts later.
    public const int WindowMs = 2000;

    private const long Disarmed = long.MinValue;

    private readonly Func<long> _nowMs;
    private long _armedAtMs = Disarmed;

    public AbortArm(Func<long> nowMs)
    {
        _nowMs = nowMs ?? throw new ArgumentNullException(nameof(nowMs));
    }

    public void Arm() => Interlocked.Exchange(ref _armedAtMs, _nowMs());

    public void Clear() => Interlocked.Exchange(ref _armedAtMs, Disarmed);

    /// <summary>True once per arming, and only while it is fresh.</summary>
    public bool Consume()
    {
        var armedAt = Interlocked.Exchange(ref _armedAtMs, Disarmed);
        return armedAt != Disarmed && _nowMs() - armedAt < WindowMs;
    }
}
