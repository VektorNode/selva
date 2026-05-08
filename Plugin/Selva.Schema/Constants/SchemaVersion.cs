using System;

namespace Selva.Schema.Constants;

/// <summary>
///   Central definition of schema version constants.
///   This is the single source of truth for schema versioning.
/// </summary>
public static class SchemaVersion
{
	/// <summary>
	///   Current version of the schema format (MAJOR.MINOR.PATCH).
	///   Update this when making breaking or non-breaking changes to the schema.
	/// </summary>
	public static readonly Version CURRENT = new(2, 8, 0);

	/// <summary>
	///   Current version as a string (e.g., "2.8.0").
	///   Used for serialization and comparison.
	/// </summary>
	public static readonly string CURRENT_STRING = CURRENT.ToString();
}
