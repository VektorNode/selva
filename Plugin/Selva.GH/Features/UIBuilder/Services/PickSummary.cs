using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>What the page shows for a viewport pick. Rhino-free; <see cref="GeometryPicks" /> names the kinds.</summary>
internal static class PickSummary
{
    /// <summary>"2 curves", "1 point", "3 objects" when the kinds differ.</summary>
    /// <param name="kinds">One name per picked item, singular and plural.</param>
    public static string Of(IReadOnlyCollection<(string Singular, string Plural)> kinds)
    {
        var distinct = kinds.Distinct().ToList();
        var (singular, plural) = distinct.Count == 1 ? distinct[0] : ("object", "objects");
        return kinds.Count == 1 ? $"1 {singular}" : $"{kinds.Count} {plural}";
    }
}
