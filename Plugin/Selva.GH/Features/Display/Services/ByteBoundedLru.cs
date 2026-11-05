using System.Collections.Generic;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     A thread-safe LRU bounded by the bytes its entries report, not by their count: one entry can
///     be a few kilobytes or hundreds of megabytes. Values are shared with every caller that hits
///     them, so they must never be mutated after <see cref="Add" />.
/// </summary>
public sealed class ByteBoundedLru<TKey, TValue>
{
    private readonly Dictionary<TKey, LinkedListNode<Entry>> _index = new Dictionary<TKey, LinkedListNode<Entry>>();
    private readonly object _lock = new object();

    // Most recently used first.
    private readonly LinkedList<Entry> _order = new LinkedList<Entry>();
    private long _bytes;

    public ByteBoundedLru(long maxBytes)
    {
        MaxBytes = maxBytes;
    }

    public long MaxBytes { get; }

    public (int count, long bytes) Stats
    {
        get
        {
            lock (_lock)
            {
                return (_index.Count, _bytes);
            }
        }
    }

    public bool TryGet(TKey key, out TValue value)
    {
        lock (_lock)
        {
            if (_index.TryGetValue(key, out var node))
            {
                _order.Remove(node);
                _order.AddFirst(node);
                value = node.Value.Value;
                return true;
            }
        }

        value = default;
        return false;
    }

    /// <summary>
    ///     Stores <paramref name="value" />, evicting least recently used entries until it fits. An
    ///     entry larger than <see cref="MaxBytes" /> is not stored: it would evict everything else
    ///     and then itself.
    /// </summary>
    public void Add(TKey key, TValue value, long bytes)
    {
        if (bytes > MaxBytes)
        {
            return;
        }

        lock (_lock)
        {
            if (_index.TryGetValue(key, out var existing))
            {
                _order.Remove(existing);
                _bytes -= existing.Value.Bytes;
            }

            var node = _order.AddFirst(new Entry(key, value, bytes));
            _index[key] = node;
            _bytes += bytes;

            while (_bytes > MaxBytes && _order.Last != null)
            {
                var last = _order.Last;
                _order.RemoveLast();
                _index.Remove(last.Value.Key);
                _bytes -= last.Value.Bytes;
            }
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _index.Clear();
            _order.Clear();
            _bytes = 0;
        }
    }

    private readonly struct Entry
    {
        public Entry(TKey key, TValue value, long bytes)
        {
            Key = key;
            Value = value;
            Bytes = bytes;
        }

        public TKey Key { get; }
        public TValue Value { get; }
        public long Bytes { get; }
    }
}
