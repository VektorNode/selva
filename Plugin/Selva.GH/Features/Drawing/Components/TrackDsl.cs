using System;
using System.Collections.Generic;
using System.Globalization;
using Selva.Drawing.Model.Layout;

namespace Selva.GH.Features.Drawing.Components;

// Text DSL for column/row tracks: "40 auto 1*" → Absolute(40), Auto, Star(1). Throws
// FormatException with a user-facing message for invalid tokens.
public static class TrackDsl
{
    public static IReadOnlyList<GridLength> Parse(string dsl, string axis)
    {
        var list = new List<GridLength>();
        if (string.IsNullOrWhiteSpace(dsl)) return list;
        foreach (var raw in dsl.Split(new[] { ' ', '\t', ',' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var t = raw.Trim();
            if (t.Equals("auto", StringComparison.OrdinalIgnoreCase))
            {
                list.Add(GridLength.Auto);
            }
            else if (t.EndsWith("*"))
            {
                var w = t.Substring(0, t.Length - 1);
                if (w.Length == 0)
                {
                    list.Add(GridLength.Star(1.0));
                }
                else if (double.TryParse(w, NumberStyles.Float, CultureInfo.InvariantCulture, out var weight))
                {
                    list.Add(GridLength.Star(weight));
                }
                else
                {
                    throw new FormatException(
                        $"{axis} DSL: \"{t}\" is not a valid star track. Expected <number>* or *.");
                }
            }
            else if (double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var mm))
            {
                list.Add(GridLength.Absolute(mm));
            }
            else
            {
                throw new FormatException(
                    $"{axis} DSL: \"{t}\" is not a valid track. Expected <mm>, auto, or <weight>*.");
            }
        }
        return list;
    }
}
