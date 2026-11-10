using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

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

    // ============================================================================
    // Resolving in the solve
    // ============================================================================

    /// <summary>
    ///     Keeps a pick that is still offered, else takes the first option; with no options known the
    ///     pick passes through. The browser resolves the same way to show what the solve used, pinned by
    ///     <c>packages/schemas/fixtures/dynamic-value-list-resolution.json</c>.
    /// </summary>
    public static ResolvedPick ResolvePick(IReadOnlyList<(string Name, string Expression)> options, string pick)
    {
        if (options == null || options.Count == 0)
        {
            return new ResolvedPick(pick ?? string.Empty, -1, false);
        }

        var index = FindMatchingIndex(options, pick);
        return index >= 0
            ? new ResolvedPick(options[index].Expression, index, false)
            : new ResolvedPick(options[0].Expression, 0, !string.IsNullOrEmpty(pick));
    }

    /// <summary>Checklist: the picks still offered, in pick order; none left gives the first option.</summary>
    public static List<ResolvedPick> ResolvePicks(IReadOnlyList<(string Name, string Expression)> options,
        IReadOnlyList<string> picks)
    {
        picks ??= Array.Empty<string>();
        if (options == null || options.Count == 0)
        {
            return picks.Select(pick => new ResolvedPick(pick, -1, false)).ToList();
        }

        var kept = new List<ResolvedPick>();
        foreach (var pick in picks)
        {
            var index = FindMatchingIndex(options, pick);
            if (index >= 0 && kept.All(k => k.Index != index))
            {
                kept.Add(new ResolvedPick(options[index].Expression, index, false));
            }
        }

        if (kept.Count == 0)
        {
            kept.Add(new ResolvedPick(options[0].Expression, 0, picks.Any(p => !string.IsNullOrEmpty(p))));
        }

        return kept;
    }

    /// <summary>
    ///     A repeated input's picks: one JSON object of row key to pick, so a pick stays with its row
    ///     when rows come and go. Anything else reads as no picks.
    /// </summary>
    public static Dictionary<string, string> ParseRowPicks(string json)
    {
        var picks = new Dictionary<string, string>();
        if (string.IsNullOrWhiteSpace(json) || json.TrimStart()[0] != '{')
        {
            return picks;
        }

        try
        {
            foreach (var property in JObject.Parse(json).Properties())
            {
                if (property.Value.Type == JTokenType.String)
                {
                    picks[property.Name] = (string)property.Value;
                }
            }
        }
        catch (Exception)
        {
            // Not a picks object: no picks, so every row takes its first option.
        }

        return picks;
    }

    /// <summary>
    ///     One pick per row, found by the row's key. <paramref name="optionsPerRow" /> holds one set for
    ///     every row, or one set per row.
    /// </summary>
    public static List<ResolvedPick> ResolveRows(IReadOnlyList<string> rowKeys,
        IReadOnlyDictionary<string, string> picks,
        IReadOnlyList<IReadOnlyList<(string Name, string Expression)>> optionsPerRow)
    {
        var resolved = new List<ResolvedPick>();
        for (var i = 0; i < (rowKeys?.Count ?? 0); i++)
        {
            var options = optionsPerRow == null || optionsPerRow.Count == 0
                ? null
                : optionsPerRow[Math.Min(i, optionsPerRow.Count - 1)];
            string pick = null;
            picks?.TryGetValue(rowKeys[i] ?? string.Empty, out pick);
            resolved.Add(ResolvePick(options, pick));
        }

        return resolved;
    }
}

/// <summary>A pick after resolution: the option's expression, its index, and whether the pick had to change.</summary>
public readonly record struct ResolvedPick(string Expression, int Index, bool Replaced);
