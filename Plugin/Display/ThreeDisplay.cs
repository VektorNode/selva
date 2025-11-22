namespace ComputeBuilder.Display;

/// <summary>
///   Represents a display object with mesh data and material properties.
/// </summary>
public class ThreeDisplay : ThreeMaterial
{
  /// <summary>
  ///   The mesh data in a string format.
  /// </summary>
  public string meshData { get; set; }

  public string name { get; set; }
  public int vertexCount { get; set; } = 0;
  public int faceCount { get; set; } = 0;
}
