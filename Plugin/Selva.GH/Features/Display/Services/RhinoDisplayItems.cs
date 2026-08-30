using System.Collections.Generic;
using Rhino.Geometry;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>Rhino-typed entry points for the Rhino-free <see cref="DisplayItem" /> factories.</summary>
public static class RhinoDisplayItems
{
    public static DisplayItem Point(Point3d position, string id, string name, string layer,
        Dictionary<string, string> metadata, string color, double? opacity)
    {
        return DisplayItem.Point(
            new DisplayPosition { X = position.X, Y = position.Y, Z = position.Z },
            id, name, layer, metadata, color, opacity);
    }
}
