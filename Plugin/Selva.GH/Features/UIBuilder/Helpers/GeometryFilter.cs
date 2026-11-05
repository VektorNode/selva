using System;
using System.Collections.Generic;
using System.Reflection;
using Grasshopper.Kernel;
using Rhino.DocObjects;

namespace Selva.GH.Features.UIBuilder.Helpers;

/// <summary>What a Get Geometry's type filter, set from its context menu, lets the user pick.</summary>
internal static class GeometryFilter
{
    // Private on Rhino's param; saved in the .gh as its "Filter" item.
    private const string FilterProperty = "ObjectTypeFilter";

    private static readonly (uint Flag, string Kind)[] Kinds =
    {
        ((uint)ObjectType.Point, "point"),
        ((uint)ObjectType.PointSet, "pointCloud"),
        ((uint)ObjectType.Curve, "curve"),
        ((uint)ObjectType.Surface, "surface"),
        ((uint)ObjectType.Brep, "polysurface"),
        ((uint)ObjectType.Extrusion, "extrusion"),
        ((uint)ObjectType.Mesh, "mesh"),
        ((uint)ObjectType.SubD, "subd"),
        ((uint)ObjectType.InstanceReference, "block")
    };

    /// <summary>Empty when the param has no filter, or one that allows every kind above.</summary>
    public static List<string> KindsOf(IGH_ContextualParameter param)
    {
        return ReadFilter(param) is ObjectType filter
            ? FilterKinds.Allowed((uint)filter, Kinds)
            : new List<string>();
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
