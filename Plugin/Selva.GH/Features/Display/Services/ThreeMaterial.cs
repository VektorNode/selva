using System.Drawing;
using System.Reflection;
using Newtonsoft.Json;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.Display.Services;

/// <summary>Material properties for a Three.js-like display object.</summary>
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
    ///     (<c>http://localhost:{port}/assets/{hash}</c>). Null omits the field from JSON, keeping
    ///     untextured materials byte-identical on the wire. Setting it also makes WebDisplay carry
    ///     the mesh's UVs into the batch.
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
