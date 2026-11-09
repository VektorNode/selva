using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Selva.GH.Config;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     The JSON settings for every bridge frame, in and out, and for the verdict Rhino.Compute
///     carries. Wire fixtures are written with them too.
/// </summary>
internal static class WireJson
{
    // TypeNameHandling.None blocks type-confusion deserialization attacks.
    public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
    {
        TypeNameHandling = TypeNameHandling.None,
        MaxDepth = AppConfig.JsonSerialization.MaxJsonDepth,
        MetadataPropertyHandling = MetadataPropertyHandling.Ignore,
        ContractResolver = new OmitAbsentOptionals()
    };

    public static readonly JsonSerializer Serializer = JsonSerializer.Create(Settings);

    /// <summary>
    ///     The generator gives an optional list no NullValueHandling, so a null one would go out as
    ///     <c>null</c>. <c>SolveOutcome.deferred</c> must be absent outside a preview instead: the
    ///     verdict fixtures are compared byte for byte by both test stacks.
    /// </summary>
    private sealed class OmitAbsentOptionals : DefaultContractResolver
    {
        protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization)
        {
            var property = base.CreateProperty(member, memberSerialization);
            if (property.DeclaringType == typeof(SolveOutcome) && property.PropertyName == "deferred")
            {
                property.NullValueHandling = NullValueHandling.Ignore;
            }

            return property;
        }
    }
}
