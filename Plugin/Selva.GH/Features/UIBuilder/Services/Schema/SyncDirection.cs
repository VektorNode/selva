using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

[JsonConverter(typeof(StringEnumConverter), true)]
public enum SyncDirection
{
    /// <summary>Apply GH value to the schema.</summary>
    FromGH,

    /// <summary>Apply schema value to GH.</summary>
    ToGH
}
