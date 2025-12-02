using System.Drawing;
using System.Reflection;
using Newtonsoft.Json;
using Selva.Core.Helpers;

namespace Selva.Features.Display.Services;

/// <summary>
///   Represents material properties for a Three.js-like display object.
/// </summary>
public class ThreeMaterial
{
  /// <summary>
  ///   The color of the material.
  /// </summary>
  [JsonProperty("color")]
  public Color Color { get; set; }

  /// <summary>
  ///   The metalness of the material (0.0 to 1.0).
  /// </summary>
  [JsonProperty("metalness")]
  public double Metalness { get; set; }

  /// <summary>
  ///   The roughness of the material (0.0 to 1.0).
  /// </summary>
  [JsonProperty("roughness")]
  public double Roughness { get; set; }

  /// <summary>
  ///   The opacity of the material (0.0 to 1.0).
  /// </summary>
  [JsonProperty("opacity")]
  public double Opacity { get; set; }

  /// <summary>
  ///   Indicates if the material is transparent.
  /// </summary>
  [JsonProperty("transparent")]
  public bool Transparent { get; set; }

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

  /// <summary>
  ///   Copies all properties from this material to a target object using reflection.
  ///   This automatically handles any new properties added to ThreeMaterial.
  ///   TODO: CHECK IF I STILL NEED THAT?
  /// </summary>
  public void CopyPropertiesTo(object target)
  {
    if (target == null) return;

    var sourceType = GetType();
    var targetType = target.GetType();

    var sourceProperties = sourceType.GetProperties(BindingFlags.Public | BindingFlags.Instance);

    foreach (var sourceProp in sourceProperties)
    {
      if (!sourceProp.CanRead) continue;

      // Find matching property in target
      var targetProp = targetType.GetProperty(sourceProp.Name, BindingFlags.Public | BindingFlags.Instance);

      if (targetProp == null || !targetProp.CanWrite) continue;

      if (targetProp.PropertyType != sourceProp.PropertyType) continue;

      var value = sourceProp.GetValue(this);

      if (IsClampedProperty(sourceProp.Name) && value is double doubleValue) value = doubleValue.Clamp(0.0, 1.0);

      targetProp.SetValue(target, value);
    }
  }

  /// <summary>
  ///   Determines if a property should be clamped between 0 and 1.
  /// </summary>
  private bool IsClampedProperty(string propertyName)
  {
    return propertyName == nameof(Metalness)
           || propertyName == nameof(Roughness)
           || propertyName == nameof(Opacity);
  }
}
