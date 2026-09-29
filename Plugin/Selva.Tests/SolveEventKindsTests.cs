using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Xunit;

namespace Selva.Tests;

/// <summary>The TS table (solve-event-kinds.test.ts) is compared against the same fixture.</summary>
public class SolveEventKindsTests
{
    [Fact]
    public void Table_MatchesTheCrossStackFixture()
    {
        var fixture = JObject.Parse(File.ReadAllText(Path.Combine(
            TestPaths.RepoRoot(), "packages", "schemas", "fixtures", "solve", "event-kinds.json")));

        var produced = new JObject(SolveEventKinds.All.Select(kv =>
        {
            var rule = new JObject { ["delivery"] = kv.Value.Delivery };
            if (kv.Value.CoalesceBy != null) rule["coalesceBy"] = kv.Value.CoalesceBy;
            return new JProperty(kv.Key, rule);
        }));

        Assert.True(JToken.DeepEquals(fixture, produced),
            $"committed: {fixture}\nproduced: {produced}");
    }

    [Fact]
    public void UnknownKind_IsBestEffort_NeverCoalesced()
    {
        Assert.Equal(SolveEventKinds.BestEffort, SolveEventKinds.DeliveryOf("valueListUpdated"));
        Assert.Null(SolveEventKinds.CoalesceKey("valueListUpdated", new Dictionary<string, object>()));
    }

    [Fact]
    public void Progress_IsKeyedBySource()
    {
        Assert.Equal("progress:mesh", SolveEventKinds.CoalesceKey("progress",
            new Dictionary<string, object> { ["source"] = "mesh" }));
        Assert.Equal("progress:", SolveEventKinds.CoalesceKey("progress", null));
        Assert.Null(SolveEventKinds.CoalesceKey("diagnostic",
            new Dictionary<string, object> { ["source"] = "mesh" }));
    }
}
