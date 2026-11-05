using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using Selva.GH.Utilities.Helpers;
using Selva.Slva;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     The bridge's side of one live solve for <see cref="PerfLog" />: from the page's value update
///     reaching Rhino's UI thread to the last mesh frame leaving the socket. Everything but the
///     send continuation runs on the UI thread, so the stamps need no lock.
/// </summary>
public sealed class BridgePerf
{
    private long _valuesAt;
    private long _solveValuesAt;
    private long _solveStart;
    private long _solveEnd;
    private int _superseded;
    private int _solveSuperseded;
    private bool _solving;

    /// <summary>
    ///     A value update reached the UI thread; the first one since a solve started times the next
    ///     solve's wait. Updates sent during a solve only get here once it ends: the solver holds the
    ///     UI thread, so the wait never includes the solve they queued behind.
    /// </summary>
    public void ValuesArrived()
    {
        if (PerfLog.Enabled && _valuesAt == 0)
        {
            _valuesAt = Stopwatch.GetTimestamp();
        }
    }

    /// <summary>An update was merged into one still waiting for a solve, so it never reaches one itself.</summary>
    public void ValuesCoalesced()
    {
        if (PerfLog.Enabled)
        {
            _superseded++;
        }
    }

    public void SolveStarted()
    {
        if (!PerfLog.Enabled)
        {
            return;
        }

        _solveValuesAt = _valuesAt;
        _valuesAt = 0;
        _solveStart = Stopwatch.GetTimestamp();
        _solveEnd = 0;
        _solveSuperseded = _superseded;
        _superseded = 0;
        _solving = true;
    }

    public void SolveEnded()
    {
        if (!PerfLog.Enabled || !_solving)
        {
            return;
        }

        _solveEnd = Stopwatch.GetTimestamp();
        _solving = false;
    }

    /// <summary>
    ///     The solve-end handlers have run, and with them the one broadcast this solve times. A later
    ///     broadcast, such as a replay to a page that just connected, has no solve of its own.
    /// </summary>
    public void SolveHandled()
    {
        _solveEnd = 0;
    }

    /// <summary>Writes the record once <paramref name="send" /> completes.</summary>
    public void Sending(Task send, IReadOnlyCollection<object> displayData)
    {
        if (!PerfLog.Enabled || _solveEnd == 0)
        {
            return;
        }

        var valuesAt = _solveValuesAt;
        var solveStart = _solveStart;
        var solveEnd = _solveEnd;
        var superseded = _solveSuperseded;
        var collected = Stopwatch.GetTimestamp();

        var batches = 0;
        var blobBytes = 0L;
        foreach (var item in displayData)
        {
            if (item is DisplayBatch { CompressedData: not null } batch)
            {
                batches++;
                blobBytes += batch.CompressedData.Length;
            }
        }

        send.ContinueWith(task =>
        {
            var sent = Stopwatch.GetTimestamp();
            PerfLog.Write("bridge", new Dictionary<string, object>
            {
                ["trigger"] = valuesAt != 0 ? "page" : "canvas",
                ["ms"] = new Dictionary<string, object>
                {
                    ["wait"] = valuesAt != 0 ? PerfLog.MsBetween(valuesAt, solveStart) : (double?)null,
                    ["solve"] = PerfLog.MsBetween(solveStart, solveEnd),
                    ["collect"] = PerfLog.MsBetween(solveEnd, collected),
                    ["send"] = PerfLog.MsBetween(collected, sent),
                    ["total"] = PerfLog.MsBetween(valuesAt != 0 ? valuesAt : solveStart, sent)
                },
                ["supersededUpdates"] = superseded,
                ["batches"] = batches,
                ["blobBytes"] = blobBytes,
                ["sendFailed"] = task.IsFaulted
            });
        }, TaskScheduler.Default);
    }
}
