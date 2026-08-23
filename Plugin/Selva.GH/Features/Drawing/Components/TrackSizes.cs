using System.Collections.Generic;
using Selva.Drawing.Model.Layout;

namespace Selva.GH.Features.Drawing.Components;

// Converts a wired number list into column/row tracks:
//   > 0  → Absolute(mm)   fixed track width/height in paper-space millimetres
//   = 0  → Auto           sized to its content
//   < 0  → Star(weight)   shares leftover space proportionally; weight = abs(value)
// Empty list means "no explicit tracks" — callers decide the fallback.
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
