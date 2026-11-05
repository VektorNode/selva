using System;
using Selva.Schema.Models;

namespace Selva.Schema.Services;

/// <summary>
///     Raises a schema's <c>minPluginVersion</c> to what its content needs. An older plugin ignores
///     fields it doesn't know and saves the schema without them, so content it can't keep has to make
///     it refuse the file instead.
/// </summary>
public static class MinPluginVersionStamp
{
    private static readonly Version OptionAssets = new Version(0, 24, 0);

    public static void Apply(UISchema schema)
    {
        if (schema?.Assets == null || schema.Assets.Count == 0)
        {
            return;
        }

        if (Version.TryParse(schema.MinPluginVersion, out var current) && current >= OptionAssets)
        {
            return;
        }

        schema.MinPluginVersion = OptionAssets.ToString(3);
    }
}
