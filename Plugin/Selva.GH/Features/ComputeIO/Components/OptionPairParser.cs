using System.Collections.Generic;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Parses "key" = value pair strings (e.g. "x" = 0) into ordered name -> value entries.
///     Shared by the Dynamic Value List input (initial options) and output (computed options).
/// </summary>
public static class OptionPairParser
{
    /// <summary>
    ///     Splits each entry on the first '=', trims whitespace, and strips a single pair of
    ///     surrounding quotes from the key. Entries without '=' or with an empty key are skipped.
    ///     Order is preserved.
    /// </summary>
    public static IEnumerable<KeyValuePair<string, string>> Parse(IEnumerable<string> pairs)
    {
        if (pairs == null)
        {
            yield break;
        }

        foreach (var raw in pairs)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            var eq = raw.IndexOf('=');
            if (eq < 0)
            {
                continue;
            }

            var key = Unquote(raw.Substring(0, eq).Trim());
            var value = raw.Substring(eq + 1).Trim();

            if (string.IsNullOrEmpty(key))
            {
                continue;
            }

            yield return new KeyValuePair<string, string>(key, value);
        }
    }

    private static string Unquote(string s)
    {
        if (s.Length >= 2 &&
            ((s[0] == '"' && s[s.Length - 1] == '"') || (s[0] == '\'' && s[s.Length - 1] == '\'')))
        {
            return s.Substring(1, s.Length - 2);
        }

        return s;
    }
}
