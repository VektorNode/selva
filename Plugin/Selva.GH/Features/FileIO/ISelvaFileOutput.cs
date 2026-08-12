namespace Selva.GH.Features.FileIO;

/// <summary>
///     Marks a component whose output wire carries FileData, so SchemaSynchronizer
///     can detect file outputs without inspecting volatile data.
/// </summary>
public interface ISelvaFileOutput
{
}
