using System.Collections.Generic;
using System.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

public enum SchemaSaveVerdict
{
    Accept,

    /// <summary>The draft forked from a canonical that is no longer current.</summary>
    RejectStaleBase,

    /// <summary>
    ///     The request carries no base hash while a canonical exists, so staleness cannot be
    ///     judged at all.
    /// </summary>
    RejectMissingBase,

    /// <summary>An empty schema would replace a non-empty one.</summary>
    RejectEmptyOverwrite
}

/// <summary>
///     Decides whether an incoming schema save may replace the stored one.
///
///     Rhino-free on purpose: this is the whole overwrite decision, so it can be tested without a
///     Grasshopper document. <see cref="BridgeOrchestrator"/> supplies the two schemas and applies
///     the verdict.
/// </summary>
public static class SchemaSaveGuard
{
    public static SchemaSaveVerdict Evaluate(UISchema current, UISchema incoming, string baseSchemaHash)
    {
        // Nothing to protect: first save on a fresh component.
        if (current == null) return SchemaSaveVerdict.Accept;

        // A save that would erase real content is refused even when the base hash matches: the
        // browser shows a fabricated empty schema whenever the wired Context Bake holds no
        // volatile data (cleared or not-yet-run solve), and saving that must not wipe the
        // definition the component still holds.
        if (IsEmpty(incoming) && !IsEmpty(current)) return SchemaSaveVerdict.RejectEmptyOverwrite;

        // No base hash means staleness is unknowable. Treating that as "fine" made the guard
        // fail open: the frontend nulls its canonical hash after a metadata update, so this is
        // reachable without anything going wrong on the wire.
        if (string.IsNullOrEmpty(baseSchemaHash)) return SchemaSaveVerdict.RejectMissingBase;

        return SchemaHash.Compute(current) == baseSchemaHash
            ? SchemaSaveVerdict.Accept
            : SchemaSaveVerdict.RejectStaleBase;
    }

    /// <summary>
    ///     A schema carrying no params and no layout content. Name, id and viewer options are
    ///     deliberately ignored: a fabricated default carries those too.
    /// </summary>
    public static bool IsEmpty(UISchema schema)
    {
        if (schema == null) return true;

        var hasParams = schema.Inputs is { Count: > 0 } || schema.Outputs is { Count: > 0 };
        if (hasParams) return false;

        return schema.Layout switch
        {
            TabbedLayoutConfig tabbed => CountItems(tabbed.Tabs?.SelectMany(t => t.Groups ?? [])) == 0,
            FlatLayoutConfig flat => CountItems(flat.Groups) == 0,
            _ => true
        };
    }

    private static int CountItems(IEnumerable<GroupConfig> groups)
    {
        if (groups == null) return 0;

        var count = 0;
        foreach (var group in groups)
        {
            if (group?.Items != null) count += group.Items.Count;
        }

        return count;
    }
}
