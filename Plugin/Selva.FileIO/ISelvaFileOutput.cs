namespace Selva.FileIO;

/// <summary>
///     Marks a component whose output wire carries FileData, so SchemaSynchronizer
///     can detect file outputs without inspecting volatile data.
///     A component that is not an <c>OBSOLETE_</c> snapshot must start its SolveInstance with
///     <c>if (SolveRuntimes.SkipFileOutput(this)) return;</c>. Preview solves defer it either way,
///     but without that call the runtime never learns it ran as a preview and expires it on every
///     preview solve, which defeats the warm-document cache.
/// </summary>
public interface ISelvaFileOutput
{
}
