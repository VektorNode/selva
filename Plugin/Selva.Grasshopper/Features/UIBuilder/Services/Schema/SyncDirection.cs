using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Selva.Grasshopper.Features.UIBuilder.Services.Schema;

/// <summary>
///   Direction of a sync change between Grasshopper and the schema.
/// </summary>
[JsonConverter(typeof(StringEnumConverter), true)]
public enum SyncDirection
{
	/// <summary>Apply GH value to the schema</summary>
	FromGH,

	/// <summary>Apply schema value to GH</summary>
	ToGH
}
