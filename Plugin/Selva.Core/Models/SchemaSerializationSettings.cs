using Newtonsoft.Json;

namespace Selva.Core.Models;

public static class SchemaSerializationSettings
{
  public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
  {
    NullValueHandling = NullValueHandling.Ignore,
    DefaultValueHandling = DefaultValueHandling.Ignore
  };
}
