using System.Collections.Generic;
using Newtonsoft.Json;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     A non-mesh display item — a curve, a point, and later labels/icons. Rides as JSON in
///     <see cref="DisplayBatch.Items" /> alongside the binary mesh blob.
///
///     This is deliberately ONE flat class with a <see cref="Kind" /> discriminant and all
///     kind-specific fields optional, rather than an abstract base with subclasses. The reason is
///     the Goo round-trip: <c>WebDisplayGoo.Read</c> does
///     <c>JsonConvert.DeserializeObject&lt;DisplayBatch&gt;</c> on `.gh` file load, and Newtonsoft
///     cannot reconstruct abstract-typed subclasses from a <c>kind</c> string without a custom
///     converter. A flat class round-trips trivially. The web side keeps a STRICT discriminated
///     union (<c>DisplayCurve | DisplayPoint</c>) and narrows on <c>kind</c>, so type-safety lives
///     where many consumers read these — the web — not here, where one method constructs them.
///
///     Build items via the static factories (<see cref="Curve" />, <see cref="Point" />) so a
///     half-populated item (wrong fields for its kind) can't be created by accident.
/// </summary>
public class DisplayItem
{
    /// <summary>
    ///     Discriminant: "curve" | "point" (later "label" | "icon"). The web narrows on this; an
    ///     unrecognized kind is skipped there with a warning, and round-trips losslessly here.
    /// </summary>
    [JsonProperty("kind")]
    public string Kind { get; set; }

    // ── Identity (shared with meshes via the web's DisplayIdentity shape) ──────────────────────

    /// <summary>
    ///     Stable pick key. Synthesized as <c>{sourceComponentId}:{originalIndex}</c>, matching how
    ///     meshes identify — so selection/pick code treats meshes and items uniformly. Distinct from
    ///     <see cref="Name" />, which is a human label.
    /// </summary>
    [JsonProperty("id")]
    public string Id { get; set; }

    [JsonProperty("name")] public string Name { get; set; }

    /// <summary>
    ///     Layer path for grouping in the scene manager (e.g. "Structure/Walls").
    /// </summary>
    [JsonProperty("layer")]
    public string Layer { get; set; }

    [JsonProperty("metadata", NullValueHandling = NullValueHandling.Ignore)]
    public Dictionary<string, string> Metadata { get; set; }

    // ── Style (only the material fields a line/point can actually render) ──────────────────────

    /// <summary>
    ///     Hex color string (e.g. "#RRGGBB"). Read off the component's ThreeMaterial input. Lines
    ///     and points have no PBR, so metalness/roughness are intentionally dropped.
    /// </summary>
    [JsonProperty("color", NullValueHandling = NullValueHandling.Ignore)]
    public string Color { get; set; }

    [JsonProperty("opacity", NullValueHandling = NullValueHandling.Ignore)]
    public double? Opacity { get; set; }

    // ── Curve-only ────────────────────────────────────────────────────────────────────────────

    /// <summary>
    ///     Rhino-native curve JSON (<c>curve.ToNurbsCurve().ToJSON()</c>), decoded on the web via
    ///     rhino3dm and tessellated to a THREE.Line. Null for non-curve kinds.
    /// </summary>
    [JsonProperty("json", NullValueHandling = NullValueHandling.Ignore)]
    public string Json { get; set; }

    // ── Point-only ────────────────────────────────────────────────────────────────────────────

    /// <summary>
    ///     World position in Rhino's Z-up frame, serialized as {X,Y,Z} (Rhino's own casing). The web
    ///     applies the shared Rhino→Three transform on parse, same as mesh vertices. Null for
    ///     non-point kinds.
    /// </summary>
    [JsonProperty("position", NullValueHandling = NullValueHandling.Ignore)]
    public DisplayPosition Position { get; set; }

    // ── Factories ─────────────────────────────────────────────────────────────────────────────

    /// <summary>Build a curve item from Rhino-native curve JSON.</summary>
    public static DisplayItem Curve(string json, string id, string name, string layer,
        Dictionary<string, string> metadata, string color, double? opacity)
    {
        return new DisplayItem
        {
            Kind = "curve",
            Json = json,
            Id = id,
            Name = name,
            Layer = layer,
            Metadata = metadata,
            Color = color,
            Opacity = opacity
        };
    }

    /// <summary>Build a point item from a world-space position (Rhino Z-up).</summary>
    public static DisplayItem Point(Point3d position, string id, string name, string layer,
        Dictionary<string, string> metadata, string color, double? opacity)
    {
        return new DisplayItem
        {
            Kind = "point",
            Position = new DisplayPosition { X = position.X, Y = position.Y, Z = position.Z },
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
///     A world position serialized as {X,Y,Z} (Rhino's casing). A small explicit DTO rather than
///     Rhino's <see cref="Point3d" /> struct, so Newtonsoft emits exactly three fields and the
///     nullable case (no position on non-point items) is clean.
/// </summary>
public class DisplayPosition
{
    [JsonProperty("X")] public double X { get; set; }
    [JsonProperty("Y")] public double Y { get; set; }
    [JsonProperty("Z")] public double Z { get; set; }
}
