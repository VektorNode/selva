using Newtonsoft.Json;

namespace Selva.Features.Display.Services;

/// <summary>
///   Represents a display object with mesh data and material properties.
/// </summary>
public class ThreeDisplay : ThreeMaterial
{
  /// <summary>
  ///   The mesh data in a string format.
  /// </summary>
  [JsonProperty("meshData")]
  public string MeshData { get; set; }

  [JsonProperty("name")]
  public string Name { get; set; }

  [JsonProperty("vertexCount")]
  public int VertexCount { get; set; } = 0;

  [JsonProperty("faceCount")]
  public int FaceCount { get; set; } = 0;
}
