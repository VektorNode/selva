using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Pure (Rhino/GH-free) selection logic for the Dynamic Value List parameter.
///     Operates on the ordered (Name, Expression) option list so it can be unit-tested
///     without a Grasshopper runtime. <see cref="GetDynamicValueListParameter" /> delegates here.
/// </summary>
public static class DynamicValueListLogic
{
    /// <summary>
    ///     Index of the option whose Name or Expression matches <paramref name="value" />
    ///     (case-insensitive), or -1 when none matches.
    /// </summary>
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
    ///     Expression, otherwise the value passed through verbatim. Returns the match index too so
    ///     callers can build a goo without re-scanning.
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

    /// <summary>
    ///     The default (currently selected) value when one exists, else the first known option's
    ///     expression, else empty.
    /// </summary>
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

    /// <summary>
    ///     Filters out null/empty entries from a set of selected values, preserving order.
    ///     Returns an empty list when the input is null or all entries are blank.
    /// </summary>
    public static List<string> FilterSelectableValues(IEnumerable<string> values)
    {
        if (values == null)
        {
            return new List<string>();
        }

        return values.Where(v => !string.IsNullOrEmpty(v)).ToList();
    }

    /// <summary>
    ///     Converts the ordered option list into a name -> expression dictionary.
    ///     Later entries win on duplicate names (last-write), matching the param's Values getter.
    /// </summary>
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
    ///     Computes the AtMost bound for a list/item access toggle. Switching to list access widens
    ///     an unset (<= 1) bound to unbounded; switching back to item collapses an unbounded bound to 1.
    ///     An explicit finite bound is left untouched.
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
