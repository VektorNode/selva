using System;
using Selva.GH.Features.SolveRuntime.Services;
using Xunit;

namespace Selva.Tests;

public class StepProgressTests
{
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();
    private static readonly Guid C = Guid.NewGuid();

    [Fact]
    public void FirstSolve_WeighsStepsEqually_AndLabelsTheRunningStep()
    {
        var p = new StepProgress();
        p.Begin(new[] { A, B });

        var first = p.Step(A, "a", false, 0)!.Value;
        Assert.Equal(0, first.Fraction);
        Assert.Equal("a", first.Label);

        var second = p.Step(B, "b", false, 100)!.Value;
        Assert.Equal(0.5, second.Fraction);
        Assert.Equal(2, second.Step);
        Assert.Equal(1, second.NextFraction);
        Assert.Null(second.StepMs);
        Assert.Equal(2, second.Total);
        Assert.Equal("b", second.Label);
    }

    [Fact]
    public void BranchOrder_DoesNotChangeTheBar()
    {
        var ab = new StepProgress();
        ab.Begin(new[] { A, B, C });
        ab.Step(A, "a", false, 0);
        ab.Step(B, "b", false, 10);
        var abLast = ab.Step(C, "c", false, 20)!.Value;

        var ba = new StepProgress();
        ba.Begin(new[] { A, B, C });
        ba.Step(B, "b", false, 0);
        ba.Step(A, "a", false, 10);
        var baLast = ba.Step(C, "c", false, 20)!.Value;

        Assert.Equal(abLast.Fraction, baLast.Fraction, 6);
    }

    [Fact]
    public void SecondSolve_WeighsStepsByLastDuration()
    {
        var p = new StepProgress();
        p.Begin(new[] { A, B });
        p.Step(A, "a", false, 0);
        p.Step(B, "b", false, 900);
        p.End(1000);

        p.Begin(new[] { A, B });
        p.Step(A, "a", false, 2000);
        var atB = p.Step(B, "b", false, 2900)!.Value;
        Assert.Equal(0.9, atB.Fraction, 6);
        Assert.Equal(1, atB.NextFraction, 6);
        Assert.Equal(100, atB.StepMs);
    }

    [Fact]
    public void SkippedStep_CountsAsDone_AndKeepsTheRunningLabel()
    {
        var p = new StepProgress();
        p.Begin(new[] { A, B, C });
        p.Step(A, "a", false, 0);
        var skipped = p.Step(B, "b", true, 10)!.Value;

        Assert.Equal("a", skipped.Label);
        Assert.Equal(2.0 / 3, skipped.Fraction, 6);
    }

    [Fact]
    public void PartialResolve_CountsOnlyTheExpiredReporters()
    {
        var p = new StepProgress();
        p.Begin(new[] { C });
        var only = p.Step(C, "c", false, 0)!.Value;
        Assert.Equal(1, only.Total);
    }

    [Fact]
    public void RepeatReport_InTheSameSolve_IsIgnored()
    {
        var p = new StepProgress();
        p.Begin(new[] { A, B });
        p.Step(A, "a", false, 0);
        Assert.Null(p.Step(A, "a", false, 5));
    }

    [Fact]
    public void AbortedSolve_DoesNotLearnTheCutShortStep()
    {
        var p = new StepProgress();
        p.Begin(new[] { A, B });
        p.Step(A, "a", false, 0);
        p.Step(B, "b", false, 1000);
        p.End(1010, learn: false);

        // A learned 1000 ms, B nothing: B falls back to the mean (1000), not 10.
        p.Begin(new[] { A, B });
        p.Step(A, "a", false, 0);
        Assert.Equal(0.5, p.Step(B, "b", false, 1000)!.Value.Fraction, 6);
    }
}
