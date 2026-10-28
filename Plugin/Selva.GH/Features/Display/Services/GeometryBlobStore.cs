using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Encoded geometry blobs keyed by their meshes' <see cref="MeshItemKey" />s, so a material
///     change that keeps every mesh and its grouping re-encodes nothing. The blobs are
///     process-wide; an instance is one solve's view of them, so its hits count toward that solve.
/// </summary>
public sealed class GeometryBlobStore : IGeometryBlobCache
{
    // Blobs are compressed, so this holds far more geometry than the mesh cache's bound suggests.
    private const long MaxBytes = 64L * 1024 * 1024;

    private static readonly ByteBoundedLru<GeometryBlobKey, byte[]> Blobs =
        new ByteBoundedLru<GeometryBlobKey, byte[]>(MaxBytes);

    private readonly CacheCounter _counter;

    /// <param name="counter">Null when the perf log is off.</param>
    public GeometryBlobStore(CacheCounter counter)
    {
        _counter = counter;
    }

    public static (int count, long bytes) Stats => Blobs.Stats;

    public static void Clear() => Blobs.Clear();

    public bool TryGet(GeometryBlobKey key, out byte[] blob)
    {
        var hit = Blobs.TryGet(key, out blob);
        if (hit)
        {
            _counter?.Hit();
        }
        else
        {
            _counter?.Miss();
        }

        return hit;
    }

    public void Add(GeometryBlobKey key, byte[] blob) => Blobs.Add(key, blob, blob.Length);
}
