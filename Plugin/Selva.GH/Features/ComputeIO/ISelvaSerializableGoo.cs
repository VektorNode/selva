namespace Selva.GH.Features.ComputeIO;

/// <summary>
///     Contract for Grasshopper Goo types that own their Rhino.Compute wire format. The compute fork
///     discovers implementers by reflecting on the interface's simple name (<c>ISelvaSerializableGoo</c>),
///     not assembly identity — a new Selva-family output Goo just implements this and needs no fork change.
///     The fork sets the wire object's Data to <see cref="ToComputeJson" /> and its Type to the Goo's
///     runtime type FullName, so the client can still demux on type.
/// </summary>
public interface ISelvaSerializableGoo
{
    string ToComputeJson();
}
