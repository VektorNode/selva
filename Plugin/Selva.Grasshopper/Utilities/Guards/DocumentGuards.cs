using Grasshopper.Kernel;
using Selva.Core.Models;

namespace Selva.Grasshopper.Utilities.Guards;

/// <summary>
///   Provides guard methods for common null checks and validations
/// </summary>
public static class DocumentGuards
{
  /// <summary>
  ///   Check if document is valid
  /// </summary>
  public static bool IsValid(GH_Document document, out string error)
  {
    if (document == null)
    {
      error = "Could not access Grasshopper document";
      return false;
    }

    error = null;
    return true;
  }

  /// <summary>
  ///   Check if schema exists
  /// </summary>
  public static bool HasSchema(UISchema schema, out string error)
  {
    if (schema == null)
    {
      error = "No schema available";
      return false;
    }

    error = null;
    return true;
  }

  /// <summary>
  ///   Check if document and schema are valid
  /// </summary>
  public static bool DocumentAndSchemaValid(GH_Document document, UISchema schema, out string error)
  {
    if (!IsValid(document, out error))
    {
      return false;
    }

    if (!HasSchema(schema, out error))
    {
      return false;
    }

    error = null;
    return true;
  }
}
