namespace Selva.Features.FileIO.Services;

/// <summary>
///   Represents the data and metadata for a file to be processed or stored.
/// </summary>
public class FileData
{
  /// <summary>
  ///   Gets or sets the name of the file, including its extension.
  /// </summary>
  public string FileName { get; set; }

  /// <summary>
  ///   Gets or sets the file's contents as a string.
  /// </summary>
  public string Data { get; set; }

  /// <summary>
  ///   Gets or sets the file type/extension (e.g., ".3dm"). The dot is important.
  /// </summary>
  public string FileType { get; set; } //Example .3dm -> Important with point

  /// <summary>
  ///   Gets or sets a value indicating whether the file data is Base64 encoded.
  /// </summary>
  public bool IsBase64Encoded { get; set; } = false;

  /// <summary>
  ///   Gets or sets the subfolder path where the file should be stored. Defaults to an empty string.
  /// </summary>
  public string SubFolder { get; set; } = "";
}
