using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

/// <summary>
///     Covers the identity contract of <see cref="BlobKey" /> and the hit/miss + eviction behaviour
///     of <see cref="BatchBlobCache" />.
///
///     The property that actually matters is the negative one: a key collision would serve one
///     branch's geometry in place of another's, which is a silent visual corruption rather than a
///     crash. So most of these tests assert that some single-element difference DOES change the key.
/// </summary>
public class BatchBlobCacheTests
{
    private static float[] Verts(params float[] v) => v;

    private static readonly float[] SampleVerts = { 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f };
    private static readonly int[] SampleIndices = { 0, 1, 2 };

    // ========================================================================
    // BlobKey identity
    // ========================================================================

    [Fact]
    public void Key_IsStableForIdenticalContent()
    {
        var a = BlobKey.Compute("{\"m\":1}", SampleVerts, SampleIndices, null, null);
        var b = BlobKey.Compute("{\"m\":1}", SampleVerts.ToArray(), SampleIndices.ToArray(), null, null);

        Assert.Equal(a, b);
        Assert.Equal(a.GetHashCode(), b.GetHashCode());
    }

    [Fact]
    public void Key_ChangesWhenMetadataChanges()
    {
        // Metadata carries material ids, group boundaries, names, layers and the source component
        // id — a change there changes the blob even when every vertex is identical.
        var a = BlobKey.Compute("{\"m\":1}", SampleVerts, SampleIndices, null, null);
        var b = BlobKey.Compute("{\"m\":2}", SampleVerts, SampleIndices, null, null);

        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Key_ChangesWhenASingleVertexMoves()
    {
        var moved = SampleVerts.ToArray();
        moved[4] = 1.0001f;

        Assert.NotEqual(
            BlobKey.Compute("{}", SampleVerts, SampleIndices, null, null),
            BlobKey.Compute("{}", moved, SampleIndices, null, null));
    }

    [Fact]
    public void Key_ChangesWhenASingleIndexChanges()
    {
        Assert.NotEqual(
            BlobKey.Compute("{}", SampleVerts, new[] { 0, 1, 2 }, null, null),
            BlobKey.Compute("{}", SampleVerts, new[] { 0, 2, 1 }, null, null));
    }

    [Fact]
    public void Key_DistinguishesNullChannelFromEmptyChannel()
    {
        // A null UV array writes no chunk and no flag; a zero-length one is a different blob.
        // Hashing "nothing" for both would collide these.
        Assert.NotEqual(
            BlobKey.Compute("{}", SampleVerts, SampleIndices, null, null),
            BlobKey.Compute("{}", SampleVerts, SampleIndices, System.Array.Empty<float>(), null));
    }

    [Fact]
    public void Key_DistinguishesUvChannelFromColorChannel()
    {
        Assert.NotEqual(
            BlobKey.Compute("{}", SampleVerts, SampleIndices, System.Array.Empty<float>(), null),
            BlobKey.Compute("{}", SampleVerts, SampleIndices, null, System.Array.Empty<byte>()));
    }

    [Fact]
    public void Key_ChangesWhenAVertexColorChanges()
    {
        var a = new byte[] { 255, 255, 255, 0, 0, 0, 128, 128, 128 };
        var b = a.ToArray();
        b[7] = 129;

        Assert.NotEqual(
            BlobKey.Compute("{}", SampleVerts, SampleIndices, null, a),
            BlobKey.Compute("{}", SampleVerts, SampleIndices, null, b));
    }

    [Fact]
    public void Key_ChangesWhenATrailingColorByteChanges()
    {
        // MixBytes consumes 8 bytes per round then falls through to a per-byte tail. A change in
        // that tail must still register — an early `return` in the tail loop would lose it.
        var a = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
        var b = a.ToArray();
        b[9] = 11;

        Assert.NotEqual(
            BlobKey.Compute("{}", Verts(), System.Array.Empty<int>(), null, a),
            BlobKey.Compute("{}", Verts(), System.Array.Empty<int>(), null, b));
    }

    [Fact]
    public void Key_ChangesWhenAnOddTrailingVertexComponentChanges()
    {
        // MixFloats folds pairs; a 3-component (odd-length) array exercises the single-element tail.
        var a = Verts(1f, 2f, 3f);
        var b = Verts(1f, 2f, 4f);

        Assert.NotEqual(
            BlobKey.Compute("{}", a, System.Array.Empty<int>(), null, null),
            BlobKey.Compute("{}", b, System.Array.Empty<int>(), null, null));
    }

    [Fact]
    public void Key_DistinguishesSignedZero()
    {
        // Hashing bit patterns rather than values: -0.0 == 0.0 numerically, but they are distinct
        // bit patterns and the float32 fallback path writes raw bits.
        Assert.NotEqual(
            BlobKey.Compute("{}", Verts(0f, 0f, 0f), System.Array.Empty<int>(), null, null),
            BlobKey.Compute("{}", Verts(-0f, 0f, 0f), System.Array.Empty<int>(), null, null));
    }

    [Fact]
    public void Key_ChangesWhenArrayLengthChangesButContentPrefixMatches()
    {
        // Length is mixed explicitly, so a prefix match must not collide with the longer array.
        Assert.NotEqual(
            BlobKey.Compute("{}", Verts(1f, 2f, 3f), System.Array.Empty<int>(), null, null),
            BlobKey.Compute("{}", Verts(1f, 2f, 3f, 0f, 0f, 0f), System.Array.Empty<int>(), null, null));
    }

    // ========================================================================
    // Cache behaviour
    // ========================================================================

    [Fact]
    public void Cache_MissesThenHitsForTheSameKey()
    {
        BatchBlobCache.Clear();

        var key = BlobKey.Compute("{\"unique\":\"miss-then-hit\"}", SampleVerts, SampleIndices, null, null);
        Assert.Null(BatchBlobCache.TryGet(key));

        var blob = new byte[32 * 1024];
        blob[0] = 42;
        BatchBlobCache.Store(key, blob);

        var got = BatchBlobCache.TryGet(key);
        Assert.NotNull(got);
        Assert.Same(blob, got);

        BatchBlobCache.Clear();
    }

    [Fact]
    public void Cache_DoesNotRetainBlobsBelowTheMinimumSize()
    {
        BatchBlobCache.Clear();

        var key = BlobKey.Compute("{\"unique\":\"too-small\"}", SampleVerts, SampleIndices, null, null);
        BatchBlobCache.Store(key, new byte[1024]);

        Assert.Null(BatchBlobCache.TryGet(key));

        BatchBlobCache.Clear();
    }

    [Fact]
    public void Cache_StoreIsIdempotentAndKeepsTheFirstBlob()
    {
        BatchBlobCache.Clear();

        var key = BlobKey.Compute("{\"unique\":\"idempotent\"}", SampleVerts, SampleIndices, null, null);
        var first = new byte[32 * 1024];
        var second = new byte[32 * 1024];

        BatchBlobCache.Store(key, first);
        BatchBlobCache.Store(key, second);

        // Outstanding references handed out on an earlier hit must stay valid, so the first blob wins.
        Assert.Same(first, BatchBlobCache.TryGet(key));
        Assert.Equal(1, BatchBlobCache.Stats().Count);

        BatchBlobCache.Clear();
    }

    [Fact]
    public void Cache_EvictsLeastRecentlyUsedWhenOverBudget()
    {
        BatchBlobCache.Clear();

        // 64 MB budget, 8 MB blobs: the 9th store must push something out.
        const int blobSize = 8 * 1024 * 1024;
        var keys = new BlobKey[9];
        for (var i = 0; i < 9; i++)
        {
            keys[i] = BlobKey.Compute("{\"evict\":" + i + "}", SampleVerts, SampleIndices, null, null);
            BatchBlobCache.Store(keys[i], new byte[blobSize]);

            // Touch key 0 after every store so it stays the most-recently-used entry and survives.
            if (i > 0)
            {
                BatchBlobCache.TryGet(keys[0]);
            }
        }

        var stats = BatchBlobCache.Stats();
        Assert.True(stats.Bytes <= 64L * 1024 * 1024, $"cache held {stats.Bytes} bytes, over budget");
        Assert.True(stats.Count < 9, "nothing was evicted despite exceeding the budget");

        // The repeatedly-touched entry is the one that should have survived.
        Assert.NotNull(BatchBlobCache.TryGet(keys[0]));

        BatchBlobCache.Clear();
    }

    [Fact]
    public void Cache_IgnoresBlobsLargerThanTheWholeBudget()
    {
        BatchBlobCache.Clear();

        var key = BlobKey.Compute("{\"unique\":\"oversized\"}", SampleVerts, SampleIndices, null, null);
        BatchBlobCache.Store(key, new byte[65L * 1024 * 1024]);

        Assert.Null(BatchBlobCache.TryGet(key));
        Assert.Equal(0, BatchBlobCache.Stats().Count);

        BatchBlobCache.Clear();
    }

    [Fact]
    public void Cache_ClearResetsEverything()
    {
        var key = BlobKey.Compute("{\"unique\":\"clear\"}", SampleVerts, SampleIndices, null, null);
        BatchBlobCache.Store(key, new byte[32 * 1024]);

        BatchBlobCache.Clear();

        var stats = BatchBlobCache.Stats();
        Assert.Equal(0, stats.Count);
        Assert.Equal(0, stats.Bytes);
        Assert.Null(BatchBlobCache.TryGet(key));
    }
}
