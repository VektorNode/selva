using System.Drawing;
using System.Reflection;
using Newtonsoft.Json;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Represents material properties for a Three.js-like display object.
/// </summary>
public class ThreeMaterial
{
    /// <summary>
    ///     The color of the material.
    /// </summary>
    [JsonProperty("color")]
    [JsonConverter(typeof(ColorJsonConverter))]
    public Color Color { get; set; }

    /// <summary>
    ///     The metalness of the material (0.0 to 1.0).
    /// </summary>
    [JsonProperty("metalness")]
    public double Metalness { get; set; }

    /// <summary>
    ///     The roughness of the material (0.0 to 1.0).
    /// </summary>
    [JsonProperty("roughness")]
    public double Roughness { get; set; }

    /// <summary>
    ///     The opacity of the material (0.0 to 1.0).
    /// </summary>
    [JsonProperty("opacity")]
    public double Opacity { get; set; }

    /// <summary>
    ///     Indicates if the material is transparent.
    /// </summary>
    [JsonProperty("transparent")]
    public bool Transparent { get; set; }

    /// <summary>
    ///     Optional texture reference for the material's color map: an http(s) URL, a data URI, or
    ///     a plugin asset URL (<c>http://localhost:{port}/assets/{hash}</c>). Null (the default)
    ///     omits the field from JSON entirely, keeping untextured materials byte-identical on the
    ///     wire. A material with a Map also causes WebDisplay to carry the mesh's texture
    ///     coordinates into the batch.
    /// </summary>
    [JsonProperty("map", NullValueHandling = NullValueHandling.Ignore)]
    public string Map { get; set; }

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
