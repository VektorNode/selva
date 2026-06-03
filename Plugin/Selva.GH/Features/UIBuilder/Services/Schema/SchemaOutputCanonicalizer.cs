using System;
using System.Collections.Generic;
using System.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Rhino/GH-free schema-output invariants. Lives apart from <see cref="SchemaSynchronizer" /> (which
///     is Rhino-coupled) so the invariants can be unit-tested without a Grasshopper runtime — the same
///     "extract the pure decision" pattern used for the value collector.
/// </summary>
public static class SchemaOutputCanonicalizer
{
    /// <summary>
    ///     The schema output type strings produced by a ContextBake component. Single source of truth
    ///     for the "qualifying bake output" set — the post-solve add/remove sync, the scope filter, and
    ///     ParameterTypeHelper.ClassifyBakeOutputType all agree with this. Adding a bake output type
    ///     means adding it here (and the matching detector). A test pins this set so a new type can't
    ///     be half-wired (the failure that stripped dynamicValueList outputs every solve).
    /// </summary>
    public static readonly IReadOnlyCollection<string> BakeOutputTypes =
        new[] { "file", "chart", "dynamicValueList" };

    /// <summary>
    ///     Every layout item across every group of a layout — inputs, outputs, linebreaks.
    /// </summary>
    public static IEnumerable<LayoutItemBase> GetAllLayoutItems(LayoutConfigBase layout)
    {
        if (layout is TabbedLayoutConfig { Tabs: not null } tabbed)
        {
            return tabbed.Tabs.SelectMany(t => t.Groups).SelectMany(g => g.Items);
        }

        if (layout is FlatLayoutConfig { Groups: not null } flat)
        {
            return flat.Groups.SelectMany(g => g.Items);
        }

        return Enumerable.Empty<LayoutItemBase>();
    }

    /// <summary>
    ///     Schema invariant: a dynamicValueList output present in the layout must also exist in
    ///     <see cref="UISchema.Outputs" />. The layout is a routing sink; the canonical record is
    ///     schema.Outputs. Enforcing it means every consumer (C# collector, TS router) can read ONE
    ///     place. Without it, a layout-only DynVL is silently dropped by anything scanning only Outputs.
    ///
    ///     Idempotent: re-running adds nothing once the schema is canonical.
    /// </summary>
    public static void CanonicalizeDynamicValueListOutputs(UISchema schema)
    {
        if (schema?.Layout == null)
        {
            return;
        }

        schema.Outputs ??= new List<SchemaOutput>();
        var existingIds = new HashSet<Guid>(schema.Outputs.Select(o => o.Id));

        foreach (var item in GetAllLayoutItems(schema.Layout))
        {
            if (item is not OutputDynamicValueListLayoutItem dvl)
            {
                continue;
            }

            if (!existingIds.Add(dvl.ParamId))
            {
                continue;
            }

            schema.Outputs.Add(new SchemaOutput
            {
                Id = dvl.ParamId,
                Nickname = dvl.DisplayName ?? string.Empty,
                Description = string.Empty,
                Type = "dynamicValueList",
                TargetInputId = dvl.Config?.TargetInputId ?? Guid.Empty
            });
        }
    }
}
