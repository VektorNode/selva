using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

public class ByteBoundedLruTests
{
    [Fact]
    public void EvictsLeastRecentlyUsed_ByBytes()
    {
        var lru = new ByteBoundedLru<string, string>(100);
        lru.Add("a", "A", 40);
        lru.Add("b", "B", 40);
        Assert.True(lru.TryGet("a", out _));

        lru.Add("c", "C", 40);

        Assert.True(lru.TryGet("a", out _));
        Assert.False(lru.TryGet("b", out _));
        Assert.True(lru.TryGet("c", out _));
        Assert.Equal((2, 80L), lru.Stats);
    }

    [Fact]
    public void OversizedEntry_IsNotStored_AndEvictsNothing()
    {
        var lru = new ByteBoundedLru<string, string>(100);
        lru.Add("a", "A", 40);

        lru.Add("huge", "H", 101);

        Assert.False(lru.TryGet("huge", out _));
        Assert.True(lru.TryGet("a", out _));
    }

    [Fact]
    public void ReAdding_ReplacesTheEntryAndItsBytes()
    {
        var lru = new ByteBoundedLru<string, string>(100);
        lru.Add("a", "old", 60);
        lru.Add("a", "new", 30);

        Assert.True(lru.TryGet("a", out var value));
        Assert.Equal("new", value);
        Assert.Equal((1, 30L), lru.Stats);
    }
}
