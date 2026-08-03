using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Rhino/GH-free selection logic for the Dynamic Value List parameter, so it can be unit-tested
///     without a Grasshopper runtime. <see cref="GetDynamicValueListParameter" /> delegates here.
/// </summary>
public static class DynamicValueListLogic
{
    public static int FindMatchingIndex(IReadOnlyList<(string Name, string Expression)> items, string value)
    {
        if (items == null)
        {
            return -1;
        }

        for (var i = 0; i < items.Count; i++)
        {
            if (string.Equals(items[i].Expression, value, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(items[i].Name, value, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>
    ///     Resolves a selected value to the expression that flows downstream: a matched option's
    ///     Expression, or the value passed through verbatim if nothing matches.
    /// </summary>
    public static (string Expression, int MatchIndex) ResolveExpression(
        IReadOnlyList<(string Name, string Expression)> items, string value)
    {
        var matchIndex = FindMatchingIndex(items, value);
        var expression = matchIndex >= 0 && matchIndex < items.Count
            ? items[matchIndex].Expression
            : value;
        return (expression, matchIndex);
    }

    public static string GetDefaultValue(
        IReadOnlyList<string> selectedValues,
        IReadOnlyList<(string Name, string Expression)> items)
    {
        if (selectedValues != null && selectedValues.Count > 0)
        {
            return selectedValues[0];
        }

        return items != null && items.Count > 0 ? items[0].Expression : string.Empty;
    }

    public static List<string> FilterSelectableValues(IEnumerable<string> values)
    {
        if (values == null)
        {
            return new List<string>();
        }

        return values.Where(v => !string.IsNullOrEmpty(v)).ToList();
    }

    /// <summary>Later entries win on duplicate names, matching the param's Values getter.</summary>
    public static Dictionary<string, string> ToValuesDictionary(
        IReadOnlyList<(string Name, string Expression)> items)
    {
        var dict = new Dictionary<string, string>();
        if (items == null)
        {
            return dict;
        }

        foreach (var item in items)
        {
            dict[item.Name] = item.Expression;
        }

        return dict;
    }

    /// <summary>
    ///     Switching to list access widens an unset (<= 1) bound to unbounded; switching back to item
    ///     collapses an unbounded bound to 1. An explicit finite bound is left untouched.
    /// </summary>
    public static int ResolveAtMost(bool listAccess, int currentAtMost)
    {
        if (listAccess && currentAtMost <= 1)
        {
            return int.MaxValue;
        }

        if (!listAccess && currentAtMost == int.MaxValue)
        {
            return 1;
        }

        return currentAtMost;
    }
}
