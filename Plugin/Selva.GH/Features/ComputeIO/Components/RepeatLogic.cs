using System.Collections.Generic;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Rhino-free rules behind Repeat, so they are unit-tested without Grasshopper. Problems are
///     collected rather than thrown: the component shows them as warnings and still emits what it
///     could build.
/// </summary>
public static class RepeatLogic
{
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

    /// <summary>
    ///     The options every row offers, from one line each: a plain name, or "name" = value when the
    ///     value sent to Grasshopper differs from the name shown.
    /// </summary>
    public static Dictionary<string, string> BuildOptions(IEnumerable<string> lines)
    {
        var options = new Dictionary<string, string>();
        foreach (var raw in lines)
        {
            var line = raw?.Trim();
            if (string.IsNullOrEmpty(line))
            {
                continue;
            }

            if (line.IndexOf('=') < 0)
            {
                options[line] = line;
                continue;
            }

            foreach (var pair in OptionPairParser.Parse(new[] { line }))
            {
                options[pair.Key] = pair.Value;
            }
        }

        return options;
    }
}
