using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Rhino-free rules behind Options Table: a table of valid combinations, one row each, read by a
///     chain of inputs. Each input offers the values its column still has in the rows the picks
///     before it left. The browser narrows the same way;
///     <c>packages/schemas/fixtures/pick-table.json</c> pins both.
/// </summary>
public static class PickTableLogic
{
    // Tried in this order on the header row: a tab or semicolon is never part of a column name by
    // accident, a comma can be.
    private static readonly char[] Delimiters = { '\t', ';', ',' };

    /// <summary>
    ///     Reads delimited text: the first non-empty line names the columns, every other one is a row.
    ///     Items may hold several lines, so a multiline Panel reads the same with or without
    ///     "Multiline Data".
    /// </summary>
    public static ParsedTable Parse(IEnumerable<string> text, List<string> problems)
    {
        var lines = (text ?? Enumerable.Empty<string>())
            .Where(item => item != null)
            .SelectMany(item => item.Split('\n'))
            .Select(line => line.Trim('\r', ' '))
            .Where(line => line.Length > 0)
            .ToList();
        if (lines.Count == 0)
        {
            return new ParsedTable(new List<string>(), new List<List<string>>());
        }

        var delimiter = Delimiters.FirstOrDefault(d => lines[0].IndexOf(d) >= 0);
        if (delimiter == default(char))
        {
            delimiter = ',';
        }

        var columns = Cells(lines[0], delimiter);
        var rows = new List<List<string>>();
        var ragged = 0;
        foreach (var line in lines.Skip(1))
        {
            var cells = Cells(line, delimiter);
            if (cells.Count != columns.Count)
            {
                ragged++;
            }

            // A short row leaves its last columns empty, and an empty cell is never offered.
            rows.Add(Enumerable.Range(0, columns.Count)
                .Select(i => i < cells.Count ? cells[i] : string.Empty)
                .ToList());
        }

        if (ragged > 0)
        {
            problems.Add($"{ragged} row(s) don't have {columns.Count} cells, the number of columns.");
        }

        return new ParsedTable(columns, rows);
    }

    /// <summary>
    ///     The column each input of the chain reads: the one named like the input, else the leftmost
    ///     column no input has taken. -1 when the table has run out of columns.
    /// </summary>
    public static List<int> AssignColumns(IReadOnlyList<string> columns, IReadOnlyList<string> inputNames)
    {
        var taken = new HashSet<int>();
        var assigned = new List<int>();
        foreach (var name in inputNames)
        {
            var wanted = name?.Trim();
            var index = Enumerable.Range(0, columns.Count).FirstOrDefault(
                i => !taken.Contains(i) && string.Equals(columns[i], wanted, StringComparison.OrdinalIgnoreCase), -1);
            assigned.Add(index);
            if (index >= 0)
            {
                taken.Add(index);
            }
        }

        for (var i = 0; i < assigned.Count; i++)
        {
            if (assigned[i] >= 0)
            {
                continue;
            }

            assigned[i] = Enumerable.Range(0, columns.Count).FirstOrDefault(c => !taken.Contains(c), -1);
            if (assigned[i] >= 0)
            {
                taken.Add(assigned[i]);
            }
        }

        return assigned;
    }

    /// <summary>
    ///     The rows cut down to the chain's columns, in chain order, each combination once. Columns no
    ///     input reads stay in Grasshopper: they are the definition's data, not the form's.
    /// </summary>
    public static List<List<string>> Project(ParsedTable table, IReadOnlyList<int> columnIndexes)
    {
        var seen = new HashSet<string>();
        var projected = new List<List<string>>();
        foreach (var row in table.Rows)
        {
            var cells = columnIndexes.Select(i => row[i]).ToList();
            if (seen.Add(string.Join("\u001f", cells)))
            {
                projected.Add(cells);
            }
        }

        return projected;
    }

    /// <summary>The values column <paramref name="position" /> has in these rows, each once, in row order.</summary>
    public static List<(string Name, string Expression)> Options(
        IReadOnlyList<IReadOnlyList<string>> rows, int position)
    {
        var seen = new HashSet<string>();
        var options = new List<(string Name, string Expression)>();
        foreach (var row in rows)
        {
            var cell = position < row.Count ? row[position] : null;
            if (!string.IsNullOrEmpty(cell) && seen.Add(cell))
            {
                options.Add((cell, cell));
            }
        }

        return options;
    }

    /// <summary>The rows whose column <paramref name="position" /> holds <paramref name="value" />.</summary>
    public static List<List<string>> Narrow(IReadOnlyList<List<string>> rows, int position, string value)
    {
        return rows.Where(row => position < row.Count && string.Equals(row[position], value, StringComparison.Ordinal))
            .ToList();
    }

    /// <summary>
    ///     The rows matching what the By inputs hold: one set, or one per item when a By input holds
    ///     several (a repeated input), set i taking item i and an input's last item covering the rest.
    ///     Column d of every row is By input d's cell. Cells match ignoring case, so a table may say
    ///     True where a toggle sends true. A By input with no value yet narrows nothing.
    /// </summary>
    public static List<List<List<string>>> StartSets(IReadOnlyList<List<string>> rows,
        IReadOnlyList<IReadOnlyList<string>> byValues)
    {
        var count = byValues.Count == 0 ? 1 : Math.Max(1, byValues.Max(values => values.Count));
        var sets = new List<List<List<string>>>();
        for (var i = 0; i < count; i++)
        {
            sets.Add(rows.Where(row => Enumerable.Range(0, byValues.Count).All(d =>
                byValues[d].Count == 0 || string.Equals(row[d], byValues[d][Math.Min(i, byValues[d].Count - 1)],
                    StringComparison.OrdinalIgnoreCase))).ToList());
        }

        return sets;
    }

    /// <summary>
    ///     One input's turn in the chain. <paramref name="before" /> holds the rows left by the picks
    ///     so far: one set, or one per row of a Repeat. <paramref name="picks" /> holds this input's
    ///     picks: one, or one per row when it is repeated. Row i reads set i, the last set covering
    ///     the rest, so a repeated input after a single one starts every row from the same rows.
    /// </summary>
    public static TableColumn Step(IReadOnlyList<List<List<string>>> before, int position,
        IReadOnlyList<string> picks)
    {
        var options = new List<List<(string Name, string Expression)>>();
        var resolved = new List<ResolvedPick>();
        var after = new List<List<List<string>>>();
        for (var i = 0; i < picks.Count; i++)
        {
            var rows = before.Count == 0 ? new List<List<string>>() : before[Math.Min(i, before.Count - 1)];
            var offered = Options(rows, position);
            var pick = DynamicValueListLogic.ResolvePick(offered, picks[i]);
            options.Add(offered);
            resolved.Add(pick);
            after.Add(Narrow(rows, position, pick.Expression));
        }

        // A Repeat with no rows shows nothing; the input after it still starts from what was left.
        return new TableColumn(options, resolved, picks.Count == 0 ? before.ToList() : after);
    }

    private static List<string> Cells(string line, char delimiter)
    {
        return line.Split(delimiter).Select(cell => cell.Trim().Trim('"').Trim()).ToList();
    }
}

/// <summary>
///     What one input of the chain offers and picks, per row it shows, and the rows each pick leaves
///     for the input after it.
/// </summary>
public sealed record TableColumn(
    List<List<(string Name, string Expression)>> Options,
    List<ResolvedPick> Picks,
    List<List<List<string>>> After);

/// <summary>A table as written: column names and one list of cells per row, every row as wide as the header.</summary>
public sealed record ParsedTable(List<string> Columns, List<List<string>> Rows);
