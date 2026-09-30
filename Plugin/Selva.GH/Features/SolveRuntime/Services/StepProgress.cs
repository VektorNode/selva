using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     Turns Report Progress components firing into one bar for the whole solve.
/// </summary>
/// <remarks>
///     Grasshopper solves one component at a time, but in an order the author does not control
///     (canvas order, upstream first), and it only re-runs what expired. So the author names steps
///     and never writes a fraction: the total is the reporters expected to run this solution, a
///     reporter that fires closes the step before it, and the fraction is the finished share. Any
///     order gives the same bar, and it only moves forward.
///
///     Each step's weight is half its share of last solution's time (from its report to the next
///     report or the solution's end) and half an equal share. Time alone is fragile: timings go
///     stale the moment an input changes how long a step takes (a delay from 0 to 2 s), and a step
///     measured at 1 ms would then hold the bar still for its whole real run. The equal half
///     guarantees every step visibly moves it.
/// </remarks>
public sealed class StepProgress
{
    private readonly Dictionary<Guid, double> _learnedMs = new Dictionary<Guid, double>();
    private readonly HashSet<Guid> _expected = new HashSet<Guid>();
    private readonly HashSet<Guid> _done = new HashSet<Guid>();

    // Frozen at Begin. Learning a step's time mid-solution would otherwise re-weigh the bar and
    // could move it backwards.
    private readonly Dictionary<Guid, double> _weights = new Dictionary<Guid, double>();
    private double _fallbackWeight = 1;

    private const double TimeShare = 0.5;

    private Guid? _current;
    private long _currentStartMs;
    private string _label;

    public readonly struct Snapshot
    {
        public Snapshot(double fraction, double nextFraction, double? stepMs, int step, int total,
            string label)
        {
            Fraction = fraction;
            NextFraction = nextFraction;
            StepMs = stepMs;
            Step = step;
            Total = total;
            Label = label;
        }

        public double Fraction { get; }

        /// <summary>Where <see cref="Fraction" /> lands when the running step ends.</summary>
        public double NextFraction { get; }

        /// <summary>The running step's time last solution; null before it has been timed.</summary>
        public double? StepMs { get; }

        /// <summary>
        ///     1-based number of the running step, counting skipped ones, so the UI reads "2 / 4"
        ///     while the second step runs.
        /// </summary>
        public int Step { get; }

        public int Total { get; }

        /// <summary>The running step's message. A skipped step leaves the previous one standing.</summary>
        public string Label { get; }
    }

    public void Begin(IEnumerable<Guid> expected)
    {
        _expected.Clear();
        _done.Clear();
        _current = null;
        _label = null;
        _weights.Clear();
        foreach (var id in expected) _expected.Add(id);

        if (_expected.Count == 0)
        {
            _fallbackWeight = 1;
            return;
        }

        // A step never timed takes the mean of those that were, so one new reporter neither
        // dominates the bar nor vanishes from it. Before any timing, every step is equal.
        var known = _expected.Where(_learnedMs.ContainsKey).Select(id => _learnedMs[id]).ToList();
        var unknownMs = known.Count > 0 ? Math.Max(1, known.Average()) : 1;
        var timeMs = _expected.ToDictionary(id => id,
            id => _learnedMs.TryGetValue(id, out var ms) ? Math.Max(1, ms) : unknownMs);
        var totalMs = timeMs.Values.Sum();
        var equal = 1.0 / _expected.Count;
        foreach (var id in _expected)
        {
            _weights[id] = TimeShare * timeMs[id] / totalMs + (1 - TimeShare) * equal;
        }

        // A reporter that turns up mid-solution counts as an average step.
        _fallbackWeight = equal;
    }

    /// <summary>
    ///     Null when this reporter already reported this solution: a reporter runs once per
    ///     solution, but guard anyway so a second call cannot count twice.
    /// </summary>
    /// <param name="skipped">The reporter got no data, so the step it describes will not run.</param>
    public Snapshot? Step(Guid id, string label, bool skipped, long nowMs)
    {
        if (_current == id || _done.Contains(id)) return null;

        // Not predicted at the start: expired mid-solution, or the runtime was created by this
        // very report. Count it rather than drop it.
        _expected.Add(id);
        CloseCurrent(nowMs);

        if (skipped)
        {
            _done.Add(id);
        }
        else
        {
            _current = id;
            _currentStartMs = nowMs;
            _label = label;
        }

        return Take();
    }

    /// <param name="learn">False for an aborted solution: its last step was cut short.</param>
    public void End(long nowMs, bool learn = true) => CloseCurrent(nowMs, learn);

    private void CloseCurrent(long nowMs, bool learn = true)
    {
        if (_current is not Guid id) return;
        if (learn) _learnedMs[id] = Math.Max(0, nowMs - _currentStartMs);
        _done.Add(id);
        _current = null;
    }

    private Snapshot Take()
    {
        double Weight(Guid id) => _weights.TryGetValue(id, out var w) ? w : _fallbackWeight;
        var total = _expected.Sum(Weight);
        var done = _done.Sum(Weight);
        var next = _current is Guid running ? done + Weight(running) : done;
        double? stepMs = _current is Guid timed && _learnedMs.TryGetValue(timed, out var ms) ? ms : null;
        return new Snapshot(
            total > 0 ? Math.Min(1, done / total) : 0,
            total > 0 ? Math.Min(1, next / total) : 0,
            stepMs,
            Math.Min(_expected.Count, _done.Count + (_current.HasValue ? 1 : 0)),
            _expected.Count,
            _label);
    }
}
