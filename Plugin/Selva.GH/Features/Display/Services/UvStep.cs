using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>The UV pass <see cref="DisplayUvs.Apply" /> runs for a material.</summary>
public enum UvStep
{
    /// <summary>The material needs no UVs.</summary>
    None,

    /// <summary>Rhino's surface parameters stay as they are.</summary>
    KeepSurface,

    /// <summary>The caller's authored UVs, scaled to millimetres.</summary>
    ScaleAuthored,

    /// <summary><see cref="GrainUvs" />, seeded by the item id and the map size.</summary>
    Grain,

    /// <summary><see cref="BoxUvs" />, world-aligned.</summary>
    Box
}

/// <summary>
///     Rhino-free so <see cref="MeshItemKey" /> keys on the same decision <see cref="DisplayUvs" />
///     acts on.
/// </summary>
public static class UvSteps
{
    public static UvStep For(ThreeMaterial material, bool authoredUvs)
    {
        if (material is not { NeedsUvs: true })
        {
            return UvStep.None;
        }

        return material.ResolvedMapping switch
        {
            UvMapping.Part or UvMapping.Authored when authoredUvs => UvStep.ScaleAuthored,
            UvMapping.Part or UvMapping.Authored => UvStep.Grain,
            UvMapping.World => UvStep.Box,
            _ => UvStep.KeepSurface
        };
    }
}
