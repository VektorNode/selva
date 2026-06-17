using System.Collections.Generic;
using Selva.Drawing.Model.Layout;

namespace Selva.GH.Features.Drawing.Components;

// Converts a wired number list into column/row tracks, replacing the old "40 auto 1*" text
// DSL with a GH-native convention on plain numbers:
//   > 0  → Absolute(mm)   fixed track width/height in paper-space millimetres
//   = 0  → Auto           sized to its content
//   < 0  → Star(weight)   shares leftover space proportionally; weight = abs(value)
// An empty list means "no explicit tracks" — callers decide the fallback (auto-derive from
// cell indices for Grid, all-Star for Table).
public static class TrackSizes
{
    public static IReadOnlyList<GridLength> FromNumbers(IReadOnlyList<double> values)
    {
        var list = new List<GridLength>(values.Count);
        foreach (var v in values)
        {
            if (v > 0) list.Add(GridLength.Absolute(v));
            else if (v < 0) list.Add(GridLength.Star(-v));
            else list.Add(GridLength.Auto);
        }
        return list;
    }
}
