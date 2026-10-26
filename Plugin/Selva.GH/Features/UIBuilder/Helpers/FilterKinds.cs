using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.UIBuilder.Helpers;

/// <summary>The flag math behind <see cref="GeometryFilter" />, Rhino-free.</summary>
internal static class FilterKinds
{
    /// <summary>
    ///     The kinds whose flag <paramref name="filter" /> sets. Empty when it sets all of them, which
    ///     is what a fresh Get Geometry allows: the page shows no filter then.
    /// </summary>
    public static List<string> Allowed(uint filter, IReadOnlyList<(uint Flag, string Kind)> kinds)
    {
        var allowed = kinds.Where(k => (filter & k.Flag) != 0).Select(k => k.Kind).ToList();
        return allowed.Count == kinds.Count ? new List<string>() : allowed;
    }
}
