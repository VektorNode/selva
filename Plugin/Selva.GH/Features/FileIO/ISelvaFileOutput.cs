namespace Selva.GH.Features.FileIO;

/// <summary>
///     Marker interface for Grasshopper components that produce FileDataGoo output.
///     Implement this on any component whose output wire carries FileData so that
///     SchemaManager can detect file outputs without inspecting volatile data.
/// </summary>
public interface ISelvaFileOutput
{
}
