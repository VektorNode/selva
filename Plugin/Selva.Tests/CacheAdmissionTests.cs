using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

public class CacheAdmissionTests
{
    // One solve: every key is looked up; those in `cached` hit, the rest miss. Returns the keys it stored.
    private static List<string> Solve(CacheAdmission<string> admission, IEnumerable<string> keys,
        ISet<string>? cached = null)
    {
        var pass = admission.Begin();
        var stored = new List<string>();
        foreach (var key in keys)
        {
            if (cached?.Contains(key) == true)
            {
                pass.Hit(key);
            }
            else if (pass.ShouldStore(key))
            {
                stored.Add(key);
            }
        }

        pass.End();
        return stored;
    }

    private static IEnumerable<string> Moved(int solve, int count = 10) =>
        Enumerable.Range(0, count).Select(i => $"s{solve}-{i}");

    private static CacheAdmission<string> Bypassing()
    {
        var admission = new CacheAdmission<string>();
        for (var solve = 0; solve < CacheAdmission<string>.MissedSolvesBeforeBypass; solve++)
        {
            Solve(admission, Moved(solve));
        }

        return admission;
    }

    [Fact]
    public void MissesAreStored_UntilSeveralSolvesInARowMissed()
    {
        var admission = new CacheAdmission<string>();
        for (var solve = 0; solve < CacheAdmission<string>.MissedSolvesBeforeBypass; solve++)
        {
            Assert.Equal(10, Solve(admission, Moved(solve)).Count);
        }

        Assert.True(admission.Bypassing);
        Assert.Empty(Solve(admission, Moved(99)));
    }

    // Geometry that stopped moving: a material-only change after a drag rebuilds the same keys.
    [Fact]
    public void WhileBypassing_AKeyRepeatedFromThePreviousSolveIsStored()
    {
        var admission = Bypassing();
        Solve(admission, Moved(7));

        Assert.Equal(10, Solve(admission, Moved(7)).Count);
        Assert.False(admission.Bypassing);
    }

    // One static item among many moving ones gets cached without re-admitting the moving ones.
    [Fact]
    public void WhileBypassing_OnlyTheRepeatingItemOfAMostlyMovingSolveIsStored()
    {
        var admission = Bypassing();
        Solve(admission, Moved(7, 30).Append("static"));

        Assert.Equal(["static"], Solve(admission, Moved(8, 30).Append("static")));
        Assert.True(admission.Bypassing);
    }

    [Fact]
    public void ASolveThatMostlyHits_EndsTheBypass()
    {
        var admission = Bypassing();
        var keys = Moved(5).ToList();
        Solve(admission, keys, cached: new HashSet<string>(keys));

        Assert.False(admission.Bypassing);
        Assert.Equal(10, Solve(admission, Moved(6)).Count);
    }

    // A component with nothing meshable (curves only) says nothing about hit rates.
    [Fact]
    public void ASolveWithoutLookups_DoesNotCountAsMissed()
    {
        var admission = new CacheAdmission<string>();
        for (var solve = 0; solve < CacheAdmission<string>.MissedSolvesBeforeBypass + 1; solve++)
        {
            Solve(admission, []);
        }

        Assert.False(admission.Bypassing);
    }
}
