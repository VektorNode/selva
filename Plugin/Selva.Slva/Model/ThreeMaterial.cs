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

    /// <summary>0.0 to 1.0. Null lets the viewer pick (a satin coat on metals, none otherwise).</summary>
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

    [JsonIgnore]
    public bool HasMaps =>
        !string.IsNullOrEmpty(Map)
        || !string.IsNullOrEmpty(RoughnessMap)
        || !string.IsNullOrEmpty(NormalMap);

    /// <summary>True when rendering this material needs the mesh's texture coordinates.</summary>
    [JsonIgnore]
    public bool NeedsUvs => HasMaps || Anisotropy > 0;

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
