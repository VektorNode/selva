namespace Selva.GH.Features.ComputeIO;

/// <summary>
///     Contract for Grasshopper Goo types that own their Rhino.Compute wire format. The compute fork
///     discovers any Goo implementing this interface by reflecting on the interface name — it never
///     references the declaring assembly. A new Selva-family output Goo therefore implements this
///     interface and requires no change to the fork.
/// </summary>
/// <remarks>
///     SDK convention (matched by interface simple name, not assembly identity): every Selva-family
///     plugin declares an interface named exactly <c>ISelvaSerializableGoo</c> exposing
///     <see cref="ToComputeJson" />. The fork sets the wire object's Data to <see cref="ToComputeJson" />
///     and its Type to the Goo's runtime type FullName (so the client can demux on type as before).
/// </remarks>
public interface ISelvaSerializableGoo
{
    /// <summary>
    ///     Serialize this Goo's value to the JSON payload returned by Rhino.Compute.
    /// </summary>
    string ToComputeJson();
}
