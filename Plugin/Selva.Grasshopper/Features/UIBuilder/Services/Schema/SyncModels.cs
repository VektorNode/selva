using System.Collections.Generic;

namespace Selva.Grasshopper.Features.UIBuilder.Services.Schema;

/// <summary>
///   Represents a single metadata difference between Grasshopper and schema
/// </summary>
public class SyncChange
{
	public string ParamId { get; set; }

	/// <summary>Display name (current GH nickname) for UI identification</summary>
	public string ParamNickname { get; set; }

	public string Field { get; set; } // "nickname", "description"

	public object SchemaValue { get; set; }

	public object GHValue { get; set; }

	/// <summary>FromGH = apply GHValue to schema; ToGH = apply SchemaValue to GH</summary>
	public SyncDirection Direction { get; set; }
}

/// <summary>
///   Complete sync diff showing what would change in each direction
/// </summary>
public class SyncDiff
{
	public List<SyncChange> FromGH { get; set; } = new();

	public List<SyncChange> ToGH { get; set; } = new();
}
