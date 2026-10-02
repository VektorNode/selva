namespace Selva.Slva;

/// <summary>Where WebDisplay takes a mesh's texture coordinates from.</summary>
public enum UvMapping
{
    /// <summary>Resolved per material: see <see cref="ThreeMaterial.ResolvedMapping" />.</summary>
    Auto = 0,

    /// <summary>Rhino's texture coordinates as authored: 0-1 surface parameters on a Brep.</summary>
    Surface = 1,

    /// <summary>U along the part's grain, V across it, both in mm; for anything directional.</summary>
    Part = 2,

    /// <summary>Box projection in world mm; for materials with no direction, like concrete.</summary>
    World = 3,

    /// <summary>
    ///     A mesh's own texture coordinates, in model units, such as a sheet's flat-pattern positions
    ///     with U along its rolling direction. Scaled to mm; input without its own falls back to
    ///     <see cref="Part" />.
    /// </summary>
    Authored = 4
}
