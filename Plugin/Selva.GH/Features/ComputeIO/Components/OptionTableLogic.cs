using System;
using System.Collections.Generic;
using System.Linq;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Rhino-free rules behind Options By and Repeat, so they are unit-tested without Grasshopper.
///     Problems are collected rather than thrown: the component shows them as warnings and still
///     emits what it could build.
/// </summary>
public static class OptionTableLogic
{
    /// <summary>Table key used when the driver's value matches no other key.</summary>
    public const string FallbackKey = "*";

    /// <summary>An option line is <c>"name" = value</c>, or a bare name that is its own value.</summary>
    public static bool TryParseOption(string line, out KeyValuePair<string, string> option)
    {
        option = default;
        if (string.IsNullOrWhiteSpace(line))
        {
            return false;
        }

        if (line.IndexOf('=') < 0)
        {
            var name = line.Trim();
            option = new KeyValuePair<string, string>(name, name);
            return true;
        }

        foreach (var pair in OptionPairParser.Parse(new[] { line }))
        {
            option = pair;
            return true;
        }

        return false;
    }

    /// <summary>Pairs branch i with key i.</summary>
    public static Dictionary<string, Dictionary<string, string>> BuildTable(
        IReadOnlyList<string> keys, IReadOnlyList<IReadOnlyList<string>> branches, List<string> problems)
    {
        var table = new Dictionary<string, Dictionary<string, string>>();
        if (branches.Count != keys.Count)
        {
            problems.Add($"{branches.Count} option branch(es) for {keys.Count} key(s). " +
                         "Branch i holds the options for key i.");
        }

        for (var i = 0; i < Math.Min(keys.Count, branches.Count); i++)
        {
            var key = keys[i];
            if (string.IsNullOrEmpty(key))
            {
                problems.Add($"Key {i} is empty.");
                continue;
            }

            if (table.ContainsKey(key))
            {
                problems.Add($"Key \"{key}\" appears twice.");
                continue;
            }

            var options = new Dictionary<string, string>();
            foreach (var line in branches[i])
            {
                if (!TryParseOption(line, out var option))
                {
                    continue;
                }

                if (options.ContainsKey(option.Key))
                {
                    problems.Add($"Option \"{option.Key}\" appears twice under \"{key}\".");
                    continue;
                }

                options[option.Key] = option.Value;
            }

            table[key] = options;
        }

        return table;
    }

    /// <summary>The branch for <paramref name="key" />, else the fallback branch, else nothing.</summary>
    public static Dictionary<string, string> Pick(Dictionary<string, Dictionary<string, string>> table, string key)
    {
        if (key != null && table.TryGetValue(key, out var hit))
        {
            return hit;
        }

        return table.TryGetValue(FallbackKey, out var fallback) ? fallback : new Dictionary<string, string>();
    }

    /// <summary>
    ///     Rows from parallel lists. Labels and sections may be shorter than the keys; a missing entry
    ///     leaves that row's label or section unset.
    /// </summary>
    public static List<RepeatRow> BuildRows(
        IReadOnlyList<string> keys, IReadOnlyList<string> labels, IReadOnlyList<string> sections,
        List<string> problems)
    {
        var rows = new List<RepeatRow>();
        var seen = new HashSet<string>();
        for (var i = 0; i < keys.Count; i++)
        {
            var key = keys[i]?.Trim();
            if (string.IsNullOrEmpty(key))
            {
                problems.Add($"Row {i} has no key.");
                continue;
            }

            // Picks are stored per row key, so a duplicate would make two rows share one pick.
            if (!seen.Add(key))
            {
                problems.Add($"Row key \"{key}\" appears twice. Keys must tell rows apart.");
                continue;
            }

            rows.Add(new RepeatRow(
                key,
                i < labels.Count ? labels[i] : null,
                i < sections.Count ? sections[i] : null));
        }

        if (labels.Count > keys.Count || sections.Count > keys.Count)
        {
            problems.Add("More labels or sections than keys. The extra ones are ignored.");
        }

        return rows;
    }
}
