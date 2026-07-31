using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Process-lifetime cache of encoded geometry blobs, keyed by the content that produced them.
///
///     A Grasshopper solve re-runs the whole WebDisplay pipeline whenever anything upstream changes,
///     but most edits leave most geometry untouched — dragging one slider re-solves a definition
///     whose other branches produce byte-identical vertex/index arrays. Encoding those again costs a
///     quantization pass plus a DEFLATE at <see cref="System.IO.Compression.CompressionLevel.Optimal" />,
///     which <see cref="BlobCompressor" /> measures at ~30 ms for a 2.7 MB payload. This cache turns
///     that into a hash of the same bytes (memory-bandwidth-bound, no compression) plus a dictionary
///     lookup.
///
///     <b>Identity.</b> The key is a 128-bit FNV-1a-style hash over everything that can change a
///     blob byte: the combined vertex/index/UV/color arrays and the metadata JSON (which already
///     encodes material ids, group boundaries, names, layers, per-mesh metadata and the source
///     component id — see <see cref="MeshBatchSerialization.SerializeMetadata" />). Two batches that
///     agree on all of those produce identical blobs, because <see cref="BinaryGeometryWriter.Write" />
///     is a pure function of exactly those inputs. Nothing else about the Rhino document is consulted,
///     so the cache cannot be desynced by undo/paste/document reload — a stale entry is unreachable
///     rather than wrong.
///
///     <b>Collisions.</b> 128 bits over a workload of at most a few thousand live entries puts
///     collision probability far below the rate of a cosmic-ray bit flip, which is the standard
///     content-addressing bet (git, and <see cref="TextureAssetStore" /> in this same feature, take
///     it at 128 and 256 bits respectively). A collision would serve the wrong geometry, so the
///     width is deliberately not narrowed to 64.
///
///     <b>Memory policy.</b> Bounded by total cached bytes, not entry count, since one entry can be
///     a handful of bytes or many megabytes. Eviction is least-recently-used, driven by a monotonic
///     tick stamped on every hit. Rhino is a long-lived host and this is static, so an unbounded
///     cache would be a slow leak across a day of modelling; the bound makes the worst case a fixed
///     ceiling. Blobs are stored as-is and handed back by reference — callers must treat the result
///     as read-only, which they do: <see cref="DisplayBatch.CompressedData" /> is only ever written
///     whole, never mutated in place.
/// </summary>
public static class BatchBlobCache
{
    /// <summary>
    ///     Total cached blob bytes retained before LRU eviction kicks in. 64 MB is a small fraction
    ///     of a Rhino session's working set and holds a realistic multi-branch scene comfortably,
    ///     while capping the worst case for a user who cycles through very large definitions.
    /// </summary>
    private const long MaxBytes = 64L * 1024 * 1024;

    /// <summary>
    ///     Blobs below this size are not cached. The encode they would save is proportionally tiny
    ///     (<see cref="BlobCompressor" /> does not even compress under 4 KB), so caching them only
    ///     spends dictionary entries and eviction bookkeeping.
    /// </summary>
    private const int MinCacheableBytes = 16 * 1024;

    private static readonly object Gate = new object();
    private static readonly Dictionary<BlobKey, Entry> Entries = new Dictionary<BlobKey, Entry>();
    private static long _totalBytes;
    private static long _tick;

    /// <summary>Diagnostics only: hits/misses since process start. Not part of the contract.</summary>
    private static long _hits;

    private static long _misses;

    private sealed class Entry
    {
        public byte[] Blob;
        public long LastUsed;
    }

    /// <summary>
    ///     Returns the cached blob for this content, or null on a miss. The caller encodes on a miss
    ///     and calls <see cref="Store" /> with the same key.
    /// </summary>
    public static byte[] TryGet(BlobKey key)
    {
        lock (Gate)
        {
            if (Entries.TryGetValue(key, out var entry))
            {
                entry.LastUsed = ++_tick;
                _hits++;
                return entry.Blob;
            }

            _misses++;
            return null;
        }
    }

    /// <summary>
    ///     Records a freshly encoded blob. Silently ignores blobs below
    ///     <see cref="MinCacheableBytes" /> and any single blob larger than the whole budget.
    /// </summary>
    public static void Store(BlobKey key, byte[] blob)
    {
        if (blob == null || blob.Length < MinCacheableBytes || blob.Length > MaxBytes)
        {
            return;
        }

        lock (Gate)
        {
            if (Entries.TryGetValue(key, out var existing))
            {
                // Same content already present (two branches encoding identical geometry, or a
                // concurrent miss on both). Keep the first blob so outstanding references stay valid.
                existing.LastUsed = ++_tick;
                return;
            }

            Entries[key] = new Entry { Blob = blob, LastUsed = ++_tick };
            _totalBytes += blob.Length;
            EvictIfNeeded();
        }
    }

    /// <summary>Drops everything. Exposed for tests and for a manual memory reset.</summary>
    public static void Clear()
    {
        lock (Gate)
        {
            Entries.Clear();
            _totalBytes = 0;
            _tick = 0;
            _hits = 0;
            _misses = 0;
        }
    }

    /// <summary>Diagnostics snapshot: (entry count, total bytes, hits, misses).</summary>
    public static (int Count, long Bytes, long Hits, long Misses) Stats()
    {
        lock (Gate)
        {
            return (Entries.Count, _totalBytes, _hits, _misses);
        }
    }

    /// <summary>
    ///     Evicts least-recently-used entries until the budget is met. Called under
    ///     <see cref="Gate" />. Linear scans per eviction are fine: eviction is rare relative to
    ///     lookups, and the entry count stays in the hundreds at this budget.
    /// </summary>
    private static void EvictIfNeeded()
    {
        while (_totalBytes > MaxBytes && Entries.Count > 0)
        {
            var oldestTick = long.MaxValue;
            var oldestKey = default(BlobKey);
            var found = false;

            foreach (var kvp in Entries)
            {
                if (kvp.Value.LastUsed < oldestTick)
                {
                    oldestTick = kvp.Value.LastUsed;
                    oldestKey = kvp.Key;
                    found = true;
                }
            }

            if (!found)
            {
                return;
            }

            _totalBytes -= Entries[oldestKey].Blob.Length;
            Entries.Remove(oldestKey);
        }
    }
}

/// <summary>
///     128-bit content hash identifying an encoded blob. A value type with structural equality so it
///     can key a dictionary without allocating.
/// </summary>
public readonly struct BlobKey : IEquatable<BlobKey>
{
    private readonly ulong _low;
    private readonly ulong _high;

    private BlobKey(ulong low, ulong high)
    {
        _low = low;
        _high = high;
    }

    /// <summary>
    ///     Hashes everything that feeds <see cref="BinaryGeometryWriter.Write" />. Null arrays are
    ///     distinguished from empty ones: a batch with no UV chunk must not collide with a batch
    ///     carrying a zero-length one, since the flags word differs and so do the bytes.
    /// </summary>
    public static BlobKey Compute(
        string metadataJson,
        float[] vertices,
        int[] indices,
        float[] uvs,
        byte[] colors)
    {
        // Two independent FNV-1a lanes with different offset bases, combined into 128 bits. FNV is
        // used rather than a cryptographic hash because this guards against accidental collision,
        // not an adversary — nothing here is attacker-controlled, and the pass has to keep up with
        // memory bandwidth to be worth doing at all.
        var h1 = 0xcbf29ce484222325UL;
        var h2 = 0x9e3779b97f4a7c15UL;

        MixString(ref h1, ref h2, metadataJson);
        MixTag(ref h1, ref h2, vertices == null ? 0u : 1u);
        MixFloats(ref h1, ref h2, vertices);
        MixTag(ref h1, ref h2, indices == null ? 0u : 2u);
        MixInts(ref h1, ref h2, indices);
        MixTag(ref h1, ref h2, uvs == null ? 0u : 3u);
        MixFloats(ref h1, ref h2, uvs);
        MixTag(ref h1, ref h2, colors == null ? 0u : 4u);
        MixBytes(ref h1, ref h2, colors);

        return new BlobKey(h1, h2);
    }

    private static void Mix(ref ulong h1, ref ulong h2, ulong value)
    {
        h1 = (h1 ^ value) * 0x100000001b3UL;
        h2 = (h2 ^ value) * 0xff51afd7ed558ccdUL;
        h2 ^= h2 >> 29;
    }

    private static void MixTag(ref ulong h1, ref ulong h2, uint tag)
    {
        Mix(ref h1, ref h2, tag);
    }

    private static void MixString(ref ulong h1, ref ulong h2, string s)
    {
        if (s == null)
        {
            Mix(ref h1, ref h2, 0xFFFFFFFFFFFFFFFFUL);
            return;
        }

        Mix(ref h1, ref h2, (ulong)s.Length);
        for (var i = 0; i < s.Length; i++)
        {
            Mix(ref h1, ref h2, s[i]);
        }
    }

    private static void MixFloats(ref ulong h1, ref ulong h2, float[] a)
    {
        if (a == null)
        {
            return;
        }

        Mix(ref h1, ref h2, (ulong)a.Length);

        // Hash the raw bit patterns, and fold pairs so the loop does half as many rounds. Bit
        // patterns rather than values because the encoder is bit-exact: -0.0 and +0.0 quantize
        // identically today, but NaN payloads and the float32 fallback path both write raw bits,
        // so distinguishing them keeps the key faithful to the output.
        //
        // SingleToBits is a local reimplementation: BitConverter.SingleToInt32Bits is .NET Core
        // only, and this assembly also targets net48.
        var i = 0;
        for (; i + 1 < a.Length; i += 2)
        {
            var lo = SingleToBits(a[i]);
            var hi = SingleToBits(a[i + 1]);
            Mix(ref h1, ref h2, ((ulong)hi << 32) | lo);
        }

        if (i < a.Length)
        {
            Mix(ref h1, ref h2, SingleToBits(a[i]));
        }
    }

    /// <summary>
    ///     Raw IEEE-754 bit pattern of a float. <c>BitConverter.SingleToInt32Bits</c> is .NET Core
    ///     only and this assembly also targets net48, so reinterpret through an explicit-layout
    ///     union — which keeps the project free of <c>AllowUnsafeBlocks</c>. Bit-exact on every
    ///     target, including for NaN payloads and -0.0.
    /// </summary>
    [StructLayout(LayoutKind.Explicit)]
    private struct FloatBits
    {
        [FieldOffset(0)] public float Value;
        [FieldOffset(0)] public uint Bits;
    }

    private static uint SingleToBits(float value)
    {
        return new FloatBits { Value = value }.Bits;
    }

    private static void MixInts(ref ulong h1, ref ulong h2, int[] a)
    {
        if (a == null)
        {
            return;
        }

        Mix(ref h1, ref h2, (ulong)a.Length);

        var i = 0;
        for (; i + 1 < a.Length; i += 2)
        {
            Mix(ref h1, ref h2, ((ulong)(uint)a[i + 1] << 32) | (uint)a[i]);
        }

        if (i < a.Length)
        {
            Mix(ref h1, ref h2, (uint)a[i]);
        }
    }

    private static void MixBytes(ref ulong h1, ref ulong h2, byte[] a)
    {
        if (a == null)
        {
            return;
        }

        Mix(ref h1, ref h2, (ulong)a.Length);

        var i = 0;
        for (; i + 7 < a.Length; i += 8)
        {
            var chunk = (ulong)a[i]
                        | ((ulong)a[i + 1] << 8)
                        | ((ulong)a[i + 2] << 16)
                        | ((ulong)a[i + 3] << 24)
                        | ((ulong)a[i + 4] << 32)
                        | ((ulong)a[i + 5] << 40)
                        | ((ulong)a[i + 6] << 48)
                        | ((ulong)a[i + 7] << 56);
            Mix(ref h1, ref h2, chunk);
        }

        for (; i < a.Length; i++)
        {
            Mix(ref h1, ref h2, a[i]);
        }
    }

    public bool Equals(BlobKey other)
    {
        return _low == other._low && _high == other._high;
    }

    public override bool Equals(object obj)
    {
        return obj is BlobKey other && Equals(other);
    }

    public override int GetHashCode()
    {
        var mixed = _low ^ _high;
        return (int)mixed ^ (int)(mixed >> 32);
    }

    public override string ToString()
    {
        return _high.ToString("x16") + _low.ToString("x16");
    }
}
