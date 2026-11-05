using System.Collections.Generic;

namespace Selva.Schema.Constants;

/// <summary>
///     The paramTypes of Rhino's Get Geometry, Get Point, Get Line and Get Plane. Their geometry is
///     picked in the viewport and stays on the Grasshopper param, so the page never sends a value
///     for them and the bridge never reports one back.
/// </summary>
public static class GeometryParamTypes
{
    private static readonly HashSet<string> All = new HashSet<string> { "geometry", "point", "line", "plane" };

    public static bool Contains(string paramType) => paramType != null && All.Contains(paramType);
}
