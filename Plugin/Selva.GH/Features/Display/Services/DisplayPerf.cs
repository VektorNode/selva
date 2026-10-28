using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Rhino.Geometry;
using Selva.GH.Utilities.Helpers;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     One Display solve's cost for <see cref="PerfLog" />, stage by stage, plus reuse:
///     <see cref="MeshItemCache" /> and <see cref="GeometryBlobStore" /> hits, items whose geometry is unchanged since the component's
///     previous solve (the most the cache could hit), and branches whose batch came out
///     byte-identical (what not resending them would save).
///     Exists only while the log is on; every caller holds it as a nullable.
/// </summary>
public sealed class DisplayPerf
{
    // The component's previous solve, keyed by component id, to compare the next one against.
    private static readonly ConcurrentDictionary<string, HashSet<string>> PreviousGeometry =
        new ConcurrentDictionary<string, HashSet<string>>();

    // Branch path -> SHA-256 of its blob. Hashes, not blobs: entries live as long as the process.
    private static readonly ConcurrentDictionary<string, Dictionary<string, string>> PreviousBatches =
        new ConcurrentDictionary<string, Dictionary<string, string>>();

    private readonly Dictionary<string, object> _passMs = new Dictionary<string, object>();
    private readonly long _start = Stopwatch.GetTimestamp();
    private long _lastPass;

    // Summed over the parallel pass's threads, so they add up to CPU time, not wall time.
    private long _meshTicks;
    private long _normalsTicks;
    private long _uvTicks;
    private long _weldTicks;
    private long _arrayTicks;
    private long _keyTicks;

    private Dictionary<string, object> _record;

    private DisplayPerf()
    {
        _lastPass = _start;
    }

    public CacheCounter MeshCache { get; } = new CacheCounter();
    public CacheCounter BlobCache { get; } = new CacheCounter();

    public static DisplayPerf StartIfEnabled() => PerfLog.Enabled ? new DisplayPerf() : null;

    public static void Forget(string componentId)
    {
        PreviousGeometry.TryRemove(componentId, out _);
        PreviousBatches.TryRemove(componentId, out _);
    }

    public void EndPass(string name)
    {
        var now = Stopwatch.GetTimestamp();
        _passMs[name] = PerfLog.MsBetween(_lastPass, now);
        _lastPass = now;
    }

    public void AddMesh(long ticks) => Interlocked.Add(ref _meshTicks, ticks);
    public void AddNormals(long ticks) => Interlocked.Add(ref _normalsTicks, ticks);
    public void AddUvs(long ticks) => Interlocked.Add(ref _uvTicks, ticks);
    public void AddWeld(long ticks) => Interlocked.Add(ref _weldTicks, ticks);
    public void AddArrays(long ticks) => Interlocked.Add(ref _arrayTicks, ticks);
    public void AddKey(long ticks) => Interlocked.Add(ref _keyTicks, ticks);

    /// <summary>
    ///     Ends the timed stages and runs the comparisons. Called at the end of the background task,
    ///     so the comparisons stay off the UI thread and out of every stage timing.
    /// </summary>
    public void BatchesDone(string componentId, IReadOnlyList<GeometryBase> geometry,
        IReadOnlyList<(string path, DisplayBatch batch)> branches, MeshingParameters meshing)
    {
        var backgroundMs = PerfLog.MsSince(_start);

        var vertices = 0L;
        var triangles = 0L;
        var blobBytes = 0L;
        var items = 0;
        foreach (var (_, batch) in branches)
        {
            blobBytes += batch.CompressedData?.Length ?? 0;
            items += batch.Items?.Count ?? 0;
            foreach (var mesh in batch.Groups?.SelectMany(g => g.Meshes) ?? Enumerable.Empty<MeshMetadata>())
            {
                vertices += mesh.VertexCount;
                triangles += mesh.IndexCount / 3;
            }
        }

        _record = new Dictionary<string, object>
        {
            ["component"] = componentId,
            ["inputs"] = geometry.GroupBy(g => g.GetType().Name).ToDictionary(g => g.Key, g => g.Count()),
            ["branches"] = branches.Count,
            ["vertices"] = vertices,
            ["triangles"] = triangles,
            ["curvesAndPoints"] = items,
            ["blobBytes"] = blobBytes,
            ["ms"] = new Dictionary<string, object>(_passMs) { ["background"] = backgroundMs },
            ["cpuMs"] = new Dictionary<string, object>
            {
                ["mesh"] = PerfLog.Ms(_meshTicks),
                ["normals"] = PerfLog.Ms(_normalsTicks),
                ["uvs"] = PerfLog.Ms(_uvTicks),
                ["weld"] = PerfLog.Ms(_weldTicks),
                ["arrays"] = PerfLog.Ms(_arrayTicks),
                ["key"] = PerfLog.Ms(_keyTicks)
            },
            ["meshCache"] = MeshCache.Record(MeshItemCache.Stats),
            ["blobCache"] = BlobCache.Record(GeometryBlobStore.Stats),
            ["reuse"] = CompareGeometry(componentId, geometry),
            ["resend"] = CompareBatches(componentId, branches)
        };

        if (PerfLog.CompareMeshing)
        {
            _record["meshCompare"] = CompareMeshing(geometry, meshing);
        }
    }

    /// <param name="previewMs">The UI-thread preview setup that follows the background task.</param>
    public void Write(string nickname, int skipped, double previewMs, bool defaultMeshing)
    {
        if (_record == null)
        {
            return;
        }

        _record["nickname"] = nickname;
        _record["meshing"] = defaultMeshing ? "FastRenderMesh (default)" : "custom";
        _record["skipped"] = skipped;
        ((Dictionary<string, object>)_record["ms"])["preview"] = Math.Round(previewMs, 2);
        PerfLog.Write("display", _record);
    }

    /// <summary>
    ///     How many inputs are geometrically identical to one in the previous solve: the most
    ///     <see cref="MeshItemCache" /> can hit, since its key adds the meshing and UV inputs.
    /// </summary>
    private static Dictionary<string, object> CompareGeometry(string componentId,
        IReadOnlyList<GeometryBase> geometry)
    {
        var current = new HashSet<string>();
        var unchanged = 0;
        PreviousGeometry.TryGetValue(componentId, out var previous);
        foreach (var item in geometry)
        {
            var key = item.GetType().Name + ":" + item.DataCRC(0);
            current.Add(key);
            if (previous != null && previous.Contains(key))
            {
                unchanged++;
            }
        }

        PreviousGeometry[componentId] = current;
        return new Dictionary<string, object>
        {
            ["comparedToPrevious"] = previous != null,
            ["unchangedItems"] = unchanged,
            ["items"] = geometry.Count
        };
    }

    private static Dictionary<string, object> CompareBatches(string componentId,
        IReadOnlyList<(string path, DisplayBatch batch)> branches)
    {
        var current = new Dictionary<string, string>();
        var unchanged = 0;
        var unchangedBytes = 0L;
        PreviousBatches.TryGetValue(componentId, out var previous);
        using var sha = SHA256.Create();
        foreach (var (path, batch) in branches)
        {
            var blob = batch.CompressedData;
            if (blob == null)
            {
                continue;
            }

            var hash = Convert.ToBase64String(sha.ComputeHash(blob));
            current[path] = hash;
            if (previous != null && previous.TryGetValue(path, out var before) && before == hash)
            {
                unchanged++;
                unchangedBytes += blob.Length;
            }
        }

        PreviousBatches[componentId] = current;
        return new Dictionary<string, object>
        {
            ["comparedToPrevious"] = previous != null,
            ["unchangedBranches"] = unchanged,
            ["unchangedBytes"] = unchangedBytes
        };
    }

    /// <summary>Meshes every Brep and Surface input with the current settings and with Rhino's Default.</summary>
    private static Dictionary<string, object> CompareMeshing(IReadOnlyList<GeometryBase> geometry,
        MeshingParameters current)
    {
        var breps = geometry
            .Select(g => g switch
            {
                Brep b => b,
                Surface s => s.ToBrep(),
                _ => null
            })
            .Where(b => b != null)
            .ToList();

        Dictionary<string, object> Measure(MeshingParameters parameters)
        {
            var vertices = 0L;
            var triangles = 0L;
            var start = Stopwatch.GetTimestamp();
            Parallel.ForEach(breps, brep =>
            {
                var meshes = Mesh.CreateFromBrep(brep, parameters);
                if (meshes == null)
                {
                    return;
                }

                foreach (var mesh in meshes)
                {
                    Interlocked.Add(ref vertices, mesh.Vertices.Count);
                    Interlocked.Add(ref triangles, mesh.Faces.TriangleCount + 2L * mesh.Faces.QuadCount);
                }
            });
            return new Dictionary<string, object>
            {
                ["vertices"] = vertices,
                ["triangles"] = triangles,
                ["ms"] = PerfLog.MsSince(start)
            };
        }

        return new Dictionary<string, object>
        {
            ["breps"] = breps.Count,
            ["current"] = Measure(current),
            ["default"] = Measure(MeshingParameters.Default)
        };
    }
}

/// <summary>One cache's hits and misses over a solve. Thread-safe: the parallel passes share it.</summary>
public sealed class CacheCounter
{
    private int _hits;
    private int _misses;

    public void Hit() => Interlocked.Increment(ref _hits);
    public void Miss() => Interlocked.Increment(ref _misses);

    internal Dictionary<string, object> Record((int count, long bytes) stats)
    {
        return new Dictionary<string, object>
        {
            ["hits"] = _hits,
            ["misses"] = _misses,
            ["entries"] = stats.count,
            ["bytes"] = stats.bytes
        };
    }
}
