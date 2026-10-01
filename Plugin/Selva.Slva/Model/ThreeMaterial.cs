using System.Drawing;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     Material properties for a Three.js-like display object. The nullable members are omitted
///     from JSON when null, so materials that don't set them stay byte-identical on the wire and
///     the viewer keeps its own default.
/// </summary>
public class ThreeMaterial
{
    [JsonProperty("color")]
    [JsonConverter(typeof(ColorJsonConverter))]
    public Color Color { get; set; }

    /// <summary>0.0 to 1.0.</summary>
    [JsonProperty("metalness")]
    public double Metalness { get; set; }

    /// <summary>0.0 to 1.0.</summary>
    [JsonProperty("roughness")]
    public double Roughness { get; set; }

    /// <summary>0.0 to 1.0.</summary>
    [JsonProperty("opacity")]
    public double Opacity { get; set; }

    [JsonProperty("transparent")]
    public bool Transparent { get; set; }

    /// <summary>
    ///     Texture for the color map: an http(s) URL, a data URI, or a plugin asset URL
    ///     (<c>http://localhost:{port}/assets/{hash}</c>). Setting it also makes WebDisplay carry
    ///     the mesh's UVs into the batch.
    /// </summary>
    [JsonProperty("map", NullValueHandling = NullValueHandling.Ignore)]
    public string Map { get; set; }

    /// <summary>Roughness texture (green channel), same reference forms as <see cref="Map" />.</summary>
    [JsonProperty("roughnessMap", NullValueHandling = NullValueHandling.Ignore)]
    public string RoughnessMap { get; set; }

    /// <summary>Tangent-space normal texture, same reference forms as <see cref="Map" />.</summary>
    [JsonProperty("normalMap", NullValueHandling = NullValueHandling.Ignore)]
    public string NormalMap { get; set; }

    /// <summary>
    ///     Environment reflection strength. When set it wins over the viewer look's value, so a
    ///     metal stays reflective in every look. Null follows the look.
    /// </summary>
    [JsonProperty("envMapIntensity", NullValueHandling = NullValueHandling.Ignore)]
    public double? EnvMapIntensity { get; set; }

    /// <summary>0.0 to 1.0. Null: no coat.</summary>
    [JsonProperty("clearcoat", NullValueHandling = NullValueHandling.Ignore)]
    public double? Clearcoat { get; set; }

    /// <summary>0.0 to 1.0.</summary>
    [JsonProperty("clearcoatRoughness", NullValueHandling = NullValueHandling.Ignore)]
    public double? ClearcoatRoughness { get; set; }

    /// <summary>
    ///     0.0 to 1.0. Stretches highlights along the mesh's texture U direction, the grain of
    ///     brushed or rolled sheet. Without a texture map WebDisplay replaces the UVs so U follows
    ///     each part's bend axis (or longest extent when flat), not Rhino's surface parameters.
    /// </summary>
    [JsonProperty("anisotropy", NullValueHandling = NullValueHandling.Ignore)]
    public double? Anisotropy { get; set; }

    /// <summary>Grain direction in radians, counter-clockwise from texture U.</summary>
    [JsonProperty("anisotropyRotation", NullValueHandling = NullValueHandling.Ignore)]
    public double? AnisotropyRotation { get; set; }

    /// <summary>
    ///     Millimetres of the real part one repeat of the textures covers, across U; V follows the
    ///     image's aspect. Null: textures stretch once over the UVs. Only meaningful for
    ///     <see cref="UvMapping.Part" /> and <see cref="UvMapping.World" />, whose UVs are in mm.
    /// </summary>
    [JsonProperty("mapSize", NullValueHandling = NullValueHandling.Ignore)]
    public double? MapSize { get; set; }

    /// <summary>
    ///     Procedural roughness streaks along the grain: <c>"brushed"</c> (fine lines) or
    ///     <c>"rolled"</c> (broad bands). Null: uniform roughness.
    /// </summary>
    [JsonProperty("finish", NullValueHandling = NullValueHandling.Ignore)]
    public string Finish { get; set; }

    /// <summary>0.0 to 1.0. Light passing through, for glass; unlike opacity it keeps reflections.</summary>
    [JsonProperty("transmission", NullValueHandling = NullValueHandling.Ignore)]
    public double? Transmission { get; set; }

    /// <summary>Index of refraction, 1.0 to 2.333. Null: three's 1.5.</summary>
    [JsonProperty("ior", NullValueHandling = NullValueHandling.Ignore)]
    public double? Ior { get; set; }

    /// <summary>Where WebDisplay takes the texture coordinates from. Not sent to the viewer.</summary>
    [JsonProperty("mapping", DefaultValueHandling = DefaultValueHandling.Ignore)]
    public UvMapping Mapping { get; set; }

    /// <summary><see cref="UvMapping.Auto" /> resolved against this material.</summary>
    [JsonIgnore]
    public UvMapping ResolvedMapping =>
        Mapping != UvMapping.Auto ? Mapping
        // A texture with no real size was authored against Rhino's mapping; grain alone wants Part.
        : HasMaps && MapSize == null ? UvMapping.Surface
        : UvMapping.Part;

    [JsonIgnore]
    public bool HasMaps =>
        !string.IsNullOrEmpty(Map)
        || !string.IsNullOrEmpty(RoughnessMap)
        || !string.IsNullOrEmpty(NormalMap);

    /// <summary>True when rendering this material needs the mesh's texture coordinates.</summary>
    [JsonIgnore]
    public bool NeedsUvs => HasMaps || Anisotropy > 0 || !string.IsNullOrEmpty(Finish);

    /// <summary>A faithful deep copy: every member is a value type or an immutable string.</summary>
    public ThreeMaterial Clone()
    {
        return (ThreeMaterial)MemberwiseClone();
    }

    public static ThreeMaterial Default()
    {
        return new ThreeMaterial
        {
            Color = Color.White,
            Metalness = 0.0,
            Roughness = 0.5,
            Opacity = 1.0,
            Transparent = false
        };
    }
}
