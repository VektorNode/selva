using Newtonsoft.Json;
using Selva.GH.Config;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>The JSON settings for every bridge frame, in and out. Wire fixtures are written with them too.</summary>
internal static class WireJson
{
    // TypeNameHandling.None blocks type-confusion deserialization attacks.
    public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
    {
        TypeNameHandling = TypeNameHandling.None,
        MaxDepth = AppConfig.JsonSerialization.MaxJsonDepth,
        MetadataPropertyHandling = MetadataPropertyHandling.Ignore
    };

    public static readonly JsonSerializer Serializer = JsonSerializer.Create(Settings);
}
