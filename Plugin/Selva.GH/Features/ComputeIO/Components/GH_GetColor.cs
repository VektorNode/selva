using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that accepts a color from the web UI.
///     Colors are transferred as hex strings (e.g. "#FF5733") and converted to GH_Colour.
/// </summary>
public class GetColorParameter : SelvaContextualParameter<GH_Colour>
{
    public GetColorParameter()
        : base("Get Color", "Get Color", "Import a color from the web UI", GH_ParamAccess.item, "Select a color")
    {
    }

    public override string TypeName => "Color";
    public override Guid ComponentGuid => new Guid("C3A7F1D4-8E2B-4F6A-9C5D-1B3E7A4F8D2C");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.ColorInput);

    public override bool AutoAssignContextualData(GH_ParameterContext context)
    {
        var color = VolatileData.AllData(true).OfType<GH_Colour>().FirstOrDefault()?.Value ?? Color.Black;
        if (!Rhino.UI.Dialogs.ShowColorDialog(ref color))
        {
            return false;
        }

        AssignContextualData(new[] { new GH_Colour(color) });
        return true;
    }

    protected override IEnumerable<GH_Colour> FromContextual(object value)
    {
        var color = value switch
        {
            GH_Colour ghColor => ghColor,
            GH_String ghString => ParseHexToColor(ghString.Value),
            string str => ParseHexToColor(str),
            IGH_Goo goo => ParseHexToColor(goo.ScriptVariable()?.ToString()),
            _ => null
        };

        if (color == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"'{value}' is not a color");
            yield break;
        }

        yield return color;
    }

    private static GH_Colour ParseHexToColor(string hex)
    {
        if (string.IsNullOrWhiteSpace(hex))
        {
            return null;
        }

        try
        {
            return new GH_Colour(ColorTranslator.FromHtml(hex));
        }
        catch
        {
            return null;
        }
    }
}
