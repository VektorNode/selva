using System.Collections.Generic;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>A single metadata difference between Grasshopper and the schema.</summary>
public class SyncChange
{
    public string ParamId { get; set; }

    /// <summary>Current GH nickname, for UI display.</summary>
    public string ParamNickname { get; set; }

    public string Field { get; set; } // "nickname", "description"

    public object SchemaValue { get; set; }

    public object GHValue { get; set; }

    public SyncDirection Direction { get; set; }
}

/// <summary>Full sync diff: what would change in each direction.</summary>
public class SyncDiff
{
    public List<SyncChange> FromGH { get; set; } = new List<SyncChange>();

    public List<SyncChange> ToGH { get; set; } = new List<SyncChange>();
}
