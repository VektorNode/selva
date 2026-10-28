using System;
using System.Collections.Generic;
using System.Globalization;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Clamps number and integer values to their widget's min/max. The page clamps too, but a stale
///     page or a hand-written request doesn't, and one out-of-range count stalled Rhino for over a
///     minute. Rhino-free.
/// </summary>
internal sealed class NumberRanges
{
    private readonly Dictionary<Guid, NumberWidgetConfig> _byParam = new Dictionary<Guid, NumberWidgetConfig>();

    public NumberRanges(UISchema schema)
    {
        if (schema?.Layout == null)
        {
            return;
        }

        foreach (var item in SchemaOutputCanonicalizer.GetAllLayoutItems(schema.Layout))
        {
            if (item is InputNumberLayoutItem { Config: not null } number && !_byParam.ContainsKey(number.ParamId))
            {
                _byParam[number.ParamId] = number.Config;
            }
        }
    }

    /// <summary>
    ///     Returns <paramref name="value" /> unchanged when it is in range, has no range, or isn't a
    ///     number (validation reports that), else the bound it crossed: rounded inward for integers.
    /// </summary>
    public object Clamp(SchemaInput input, object value, out bool clamped)
    {
        clamped = false;
        var integer = input.ParamType == "integer";
        if ((!integer && input.ParamType != "number") || value == null ||
            !_byParam.TryGetValue(input.Id, out var range))
        {
            return value;
        }

        double number;
        try
        {
            number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }
        catch (Exception)
        {
            return value;
        }

        double bound;
        if (range.Minimum is double min && number < min)
        {
            bound = integer ? Math.Ceiling(min) : min;
        }
        else if (range.Maximum is double max && number > max)
        {
            bound = integer ? Math.Floor(max) : max;
        }
        else
        {
            return value;
        }

        clamped = true;
        return integer ? (object)Convert.ToInt64(bound) : bound;
    }
}
