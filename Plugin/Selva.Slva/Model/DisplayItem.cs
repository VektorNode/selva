using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     A non-mesh display item — a curve, a point, and later labels/icons. Rides as JSON in
///     <see cref="DisplayBatch.Items" /> alongside the binary mesh blob.
///
///     Deliberately one flat class with a <see cref="Kind" /> discriminant and all kind-specific
///     fields optional, instead of an abstract base with subclasses: <c>WebDisplayGoo.Read</c>
///     deserializes straight into <c>DisplayBatch</c> on `.gh` load, and Newtonsoft can't
///     reconstruct abstract-typed subclasses from a <c>kind</c> string without a custom converter.
///     The web side keeps a strict discriminated union (<c>DisplayCurve | DisplayPoint</c>) and
///     narrows on <c>kind</c> — type-safety lives there, not here.
///
///     Build items via the static factories (<see cref="Curve" />, <see cref="Point" />) so a
///     half-populated item (wrong fields for its kind) can't happen by accident.
/// </summary>
public class DisplayItem
{
    /// <summary>Discriminant: "curve" | "point" (later "label" | "icon").</summary>
    [JsonProperty("kind")]
    public string Kind { get; set; }

    // ── Identity (shared with meshes via the web's DisplayIdentity shape) ──────────────────────

    /// <summary>
    ///     Stable pick key, <c>{batchId}:{originalIndex}</c> — matches how meshes
    ///     identify, so selection/pick code treats meshes and items uniformly.
    /// </summary>
    [JsonProperty("id")]
    public string Id { get; set; }

    [JsonProperty("name")] public string Name { get; set; }

    /// <summary>Layer path for grouping in the scene manager (e.g. "Structure/Walls").</summary>
    [JsonProperty("layer")]
    public string Layer { get; set; }

    [JsonProperty("metadata", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, string> Metadata { get; set; }

    // ── Style (only the material fields a line/point can actually render) ──────────────────────

    /// <summary>
    ///     Hex color string (e.g. "#RRGGBB"), read off the component's ThreeMaterial input. Lines
    ///     and points have no PBR, so metalness/roughness are dropped.
    /// </summary>
    [JsonProperty("color", NullValueHandling = NullValueHandling.Ignore)]
    public string Color { get; set; }

    [JsonProperty("opacity", NullValueHandling = NullValueHandling.Ignore)]
    public double? Opacity { get; set; }

    // ── Curve-only ────────────────────────────────────────────────────────────────────────────

    /// <summary>
    ///     Rhino-native curve JSON (<c>curve.ToNurbsCurve().ToJSON()</c>). Null except for curve
    ///     items.
    ///
    ///     Rhino-side only — the web ignores it and renders from <see cref="Points" />. Keep it:
    ///     <c>WebDisplayPreview</c> rebuilds real curves from it for the viewport (points
    ///     would draw a faceted polyline) and <c>DisplayBatchTransformer</c> needs the
    ///     NURBS so repeated transforms don't compound a tessellation error. It still serializes
    ///     because <c>WebDisplayGoo.Read</c> round-trips this class through a <c>.gh</c> archive,
    ///     where losing it would degrade a saved definition's preview to its tessellation.
    /// </summary>
    [JsonProperty("json", NullValueHandling = NullValueHandling.Ignore)]
    public string Json { get; set; }

    /// <summary>
    ///     Tessellated polyline vertices, flat <c>[x,y,z, x,y,z, …]</c> in world coords, Rhino's
    ///     Z-up frame. The web builds the line straight from these — no rhino3dm in the browser.
    ///     Null except for curve items.
    /// </summary>
    [JsonProperty("points", NullValueHandling = NullValueHandling.Ignore)]
    public double[] Points { get; set; }

    // ── Point-only ────────────────────────────────────────────────────────────────────────────

    /// <summary>
    ///     World position in Rhino's Z-up frame, serialized as {X,Y,Z}. The web applies the shared
    ///     Rhino→Three transform on parse, same as mesh vertices. Null except for point items.
    /// </summary>
    [JsonProperty("position", NullValueHandling = NullValueHandling.Ignore)]
    public DisplayPosition Position { get; set; }

    // ── Factories ─────────────────────────────────────────────────────────────────────────────

    public static DisplayItem Curve(string json, double[] points, string id, string name, string layer,
        Dictionary<string, string> metadata, string color, double? opacity)
    {
        return new DisplayItem
        {
            Kind = "curve",
            Json = json,
            Points = points,
            Id = id,
            Name = name,
            Layer = layer,
            Metadata = metadata,
            Color = color,
            Opacity = opacity
        };
    }

    public static DisplayItem Point(DisplayPosition position, string id, string name, string layer,
        Dictionary<string, string> metadata, string color, double? opacity)
    {
        return new DisplayItem
        {
            Kind = "point",
            Position = position,
            Id = id,
            Name = name,
            Layer = layer,
            Metadata = metadata,
            Color = color,
            Opacity = opacity
        };
    }
}

/// <summary>
///     A world position serialized as {X,Y,Z}. A small explicit DTO instead of Rhino's
///     <c>Point3d</c> struct, so Newtonsoft emits exactly three fields and stays
///     nullable when an item has no position.
/// </summary>
public class DisplayPosition
{
    [JsonProperty("X")] public double X { get; set; }
    [JsonProperty("Y")] public double Y { get; set; }
    [JsonProperty("Z")] public double Z { get; set; }
}
