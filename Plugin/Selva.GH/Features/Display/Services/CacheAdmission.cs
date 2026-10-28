using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Decides which of one Display component's cache misses are worth storing. Geometry that moves
///     every solve (a slider driving positions) never hits, since the key holds the placed geometry,
///     and storing it evicts entries that would. After <see cref="MissedSolvesBeforeBypass" /> solves
///     that mostly missed, only items that repeat from the previous solve are stored; one solve that
///     mostly hits stores everything again. Rhino-free.
/// </summary>
public sealed class CacheAdmission<TKey>
{
    public const int MissedSolvesBeforeBypass = 3;

    // Below this share of lookups hitting, a solve counts as missed.
    private const double HitShareToStore = 0.1;

    private readonly object _lock = new object();
    private int _missedSolves;
    private HashSet<TKey> _previousKeys = new HashSet<TKey>();

    public bool Bypassing
    {
        get
        {
            lock (_lock)
            {
                return _missedSolves >= MissedSolvesBeforeBypass;
            }
        }
    }

    /// <summary>Starts one solve's lookups. Call <see cref="Pass.End" /> once it has made them all.</summary>
    public Pass Begin()
    {
        lock (_lock)
        {
            return new Pass(this, _previousKeys, _missedSolves >= MissedSolvesBeforeBypass);
        }
    }

    private void Commit(Pass pass)
    {
        lock (_lock)
        {
            var lookups = pass.Hits + pass.Misses;
            var missed = lookups > 0 && pass.Hits < lookups * HitShareToStore;
            _missedSolves = missed ? _missedSolves + 1 : 0;
            _previousKeys = new HashSet<TKey>(pass.Keys.Keys);
        }
    }

    /// <summary>One solve's lookups. Thread-safe: the parallel meshing pass shares it.</summary>
    public sealed class Pass
    {
        private readonly bool _bypass;
        private readonly CacheAdmission<TKey> _owner;
        private readonly HashSet<TKey> _previousKeys;
        private int _hits;
        private int _misses;

        internal Pass(CacheAdmission<TKey> owner, HashSet<TKey> previousKeys, bool bypass)
        {
            _owner = owner;
            _previousKeys = previousKeys;
            _bypass = bypass;
        }

        internal ConcurrentDictionary<TKey, byte> Keys { get; } = new ConcurrentDictionary<TKey, byte>();
        internal int Hits => _hits;
        internal int Misses => _misses;

        public void Hit(TKey key)
        {
            Keys.TryAdd(key, 0);
            Interlocked.Increment(ref _hits);
        }

        /// <summary>Records a miss and says whether to store the freshly built value.</summary>
        public bool ShouldStore(TKey key)
        {
            Keys.TryAdd(key, 0);

            // The previous solve built this key too, so it would have hit had it been stored.
            if (_previousKeys.Contains(key))
            {
                Interlocked.Increment(ref _hits);
                return true;
            }

            Interlocked.Increment(ref _misses);
            return !_bypass;
        }

        public void End() => _owner.Commit(this);
    }
}
