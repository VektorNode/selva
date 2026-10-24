using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Grasshopper.Kernel;
using Rhino.DocObjects;

namespace Selva.GH.Features.UIBuilder.Helpers;

/// <summary>What a Get Geometry's type filter, set from its context menu, lets the user pick.</summary>
internal static class GeometryFilter
{
    // Private on Rhino's param; saved in the .gh as its "Filter" item.
    private const string FilterProperty = "ObjectTypeFilter";

    private static readonly (ObjectType Flag, string Kind)[] Kinds =
    {
        (ObjectType.Point, "point"),
        (ObjectType.PointSet, "pointCloud"),
        (ObjectType.Curve, "curve"),
        (ObjectType.Surface, "surface"),
        (ObjectType.Brep, "polysurface"),
        (ObjectType.Extrusion, "extrusion"),
        (ObjectType.Mesh, "mesh"),
        (ObjectType.SubD, "subd"),
        (ObjectType.InstanceReference, "block")
    };

    /// <summary>
    ///     Empty when the param has no filter, or its filter allows every kind above, which is
    ///     what a fresh Get Geometry allows.
    /// </summary>
    public static List<string> KindsOf(IGH_ContextualParameter param)
    {
        if (!(ReadFilter(param) is ObjectType filter))
        {
            return new List<string>();
        }

        var kinds = Kinds.Where(k => (filter & k.Flag) != 0).Select(k => k.Kind).ToList();
        return kinds.Count == Kinds.Length ? new List<string>() : kinds;
    }

    private static ObjectType? ReadFilter(IGH_ContextualParameter param)
    {
        for (var type = param?.GetType(); type != null; type = type.BaseType)
        {
            var property = type.GetProperty(FilterProperty,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
            if (property == null)
            {
                continue;
            }

            try
            {
                return property.GetValue(param) is Enum value ? (ObjectType)Convert.ToUInt32(value) : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        return null;
    }
}
