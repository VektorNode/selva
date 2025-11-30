using Newtonsoft.Json;

namespace Selva.Features.UIBuilder.Models;

public static class SchemaSerializationSettings
{
  public static readonly JsonSerializerSettings Settings = new()
  {
    NullValueHandling = NullValueHandling.Ignore,
    DefaultValueHandling = DefaultValueHandling.Ignore
  };
}
