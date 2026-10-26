using System;
using System.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>Which schema inputs a <c>trigger</c> may press. Rhino-free; <see cref="TriggerPresses" /> checks the param.</summary>
internal static class TriggerButtons
{
    private const string BooleanParamType = "boolean";
    private const string ButtonDisplay = "button";

    /// <summary>
    ///     A boolean input laid out as a checkbox shown as a button. Any other input keeps its value
    ///     between solves, and a press would leave it true behind the page's back.
    /// </summary>
    public static bool IsButton(UISchema schema, Guid paramId)
    {
        if (schema?.Inputs?.Any(input => input.Id == paramId && input.ParamType == BooleanParamType) != true)
        {
            return false;
        }

        return SchemaOutputCanonicalizer.GetAllLayoutItems(schema.Layout)
            .OfType<InputCheckboxLayoutItem>()
            .Any(item => item.ParamId == paramId && item.Config?.DisplayAs == ButtonDisplay);
    }
}
