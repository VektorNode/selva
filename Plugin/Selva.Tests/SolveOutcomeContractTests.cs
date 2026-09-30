using System;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.SolveRuntime.Services;
using Selva.Schema.Models;
using Xunit;

namespace Selva.Tests;

/// <summary>
///     The plugin's verdict as both transports carry it: the local <c>outputs</c> envelope and
///     Rhino.Compute's <c>selva</c> block serialize this same object. The TS decoder
///     (packages/solve/src/shared/__tests__/outcome.test.ts) reads the same fixture, and checks
///     that the legacy marker path recovers the same verdict from a Compute response.
///
///     Regenerate after an intentional change:
///         UPDATE_WIRE_FIXTURES=1 dotnet test --filter SolveOutcomeContractTests
/// </summary>
public class SolveOutcomeContractTests
{
    /// <summary>
    ///     A gate error (blocks), a Notify=Log warning, an incidental warning and a remark. Sources
    ///     equal the component type names, which is what Compute's attribution reports, so the
    ///     legacy fixture can recover them.
    /// </summary>
    internal static SolveDiagnostics SampleVerdict()
    {
        var verdict = new SolveDiagnostics { Blocked = true };
        verdict.Messages.Add(new SolveDiagnostic
            { Level = "error", Message = "More than 200 spheres", Source = "Message", IsGate = true });
        verdict.Messages.Add(new SolveDiagnostic
            { Level = "warning", Message = "Radius overlaps", Source = "Message", IsGate = false });
        verdict.Messages.Add(new SolveDiagnostic
        {
            Level = "warning", Message = "Input parameter G failed to collect data", Source = "Area",
            IsGate = false
        });
        verdict.Messages.Add(new SolveDiagnostic
            { Level = "remark", Message = "Voronoi takes a while", Source = "Message", IsGate = true });
        return verdict;
    }

    [Fact]
    public void Outcome_MatchesTheCrossStackFixture()
    {
        var path = Path.Combine(TestPaths.RepoRoot(), "packages", "schemas", "fixtures", "solve", "outcome.json");
        var produced = JToken.Parse(JsonConvert.SerializeObject(SampleVerdict().ToOutcome()));

        if (Environment.GetEnvironmentVariable("UPDATE_WIRE_FIXTURES") == "1")
        {
            File.WriteAllText(path, produced.ToString(Formatting.Indented) + "\n");
            return;
        }

        var committed = JToken.Parse(File.ReadAllText(path));
        Assert.True(JToken.DeepEquals(committed, produced),
            $"committed: {committed.ToString(Formatting.None)}\nproduced: {produced.ToString(Formatting.None)}");
    }

    [Fact]
    public void Aborted_IsBlocked_AndEndsAsAborted()
    {
        var verdict = new SolveDiagnostics();
        verdict.MarkAborted();
        var outcome = verdict.ToOutcome();

        Assert.True(outcome.Blocked);
        Assert.True(outcome.Aborted);
        Assert.Equal("aborted", verdict.EndedKind);
    }

    [Fact]
    public void EndedKind_ReadsTheVerdict()
    {
        Assert.Equal("ok", new SolveDiagnostics().EndedKind);
        Assert.Equal("blocked", new SolveDiagnostics { Blocked = true }.EndedKind);
    }
}
