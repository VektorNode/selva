using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Rhino;

namespace Selva.GH.Utilities.Helpers;

/// <summary>
///     Opt-in timing log, one JSON object per line, for deciding what to optimize from measured
///     solves instead of guesses. On when the <c>SELVA_PERF_LOG</c> environment variable names a
///     file, in a desktop Rhino or a Rhino.Compute child alike. Read once per process: set it
///     before Rhino or the compute service starts. <c>scripts/perf-report.mjs</c> summarizes a log.
/// </summary>
public static class PerfLog
{
    private static readonly string FilePath = Environment.GetEnvironmentVariable("SELVA_PERF_LOG");
    private static readonly object WriteLock = new object();
    private static readonly int ProcessId = Process.GetCurrentProcess().Id;

    public static bool Enabled { get; } = !string.IsNullOrWhiteSpace(FilePath);

    /// <summary>
    ///     Also meshes every Brep a second time with <see cref="Rhino.Geometry.MeshingParameters.Default" />
    ///     to report what that setting would produce. Slows the solve it measures, so it is separate.
    /// </summary>
    public static bool CompareMeshing { get; } =
        Enabled && Environment.GetEnvironmentVariable("SELVA_PERF_MESH_COMPARE") == "1";

    public static double MsSince(long timestamp) => MsBetween(timestamp, Stopwatch.GetTimestamp());

    public static double MsBetween(long from, long to) =>
        Math.Round((to - from) * 1000.0 / Stopwatch.Frequency, 2);

    public static double Ms(long ticks) => Math.Round(ticks * 1000.0 / Stopwatch.Frequency, 2);

    /// <summary>Appends one record. Never throws: a log that can't be written must not fail a solve.</summary>
    public static void Write(string kind, Dictionary<string, object> fields)
    {
        if (!Enabled)
        {
            return;
        }

        try
        {
            var record = new Dictionary<string, object>
            {
                ["kind"] = kind,
                ["at"] = DateTime.UtcNow.ToString("O"),
                ["pid"] = ProcessId,
                ["host"] = RhinoApp.IsRunningHeadless ? "compute" : "rhino"
            };
            foreach (var field in fields)
            {
                record[field.Key] = field.Value;
            }

            var line = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(record) + "\n");

            // Shared append, one write per line: every Rhino.Compute child appends to the same file,
            // and File.AppendAllText's exclusive open would make the others fail on Windows.
            lock (WriteLock)
            {
                using var stream = new FileStream(FilePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                stream.Write(line, 0, line.Length);
            }
        }
        catch (Exception ex)
        {
            Logger.Warn($"[PerfLog] Could not write to '{FilePath}': {ex.Message}");
        }
    }
}
