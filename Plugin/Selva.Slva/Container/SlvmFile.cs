using System;
using System.IO;

namespace Selva.Slva;

/// <summary>
///     Reads and writes the Selva mesh file (<c>.slvm</c>) — a self-contained, on-disk copy of a
///     <see cref="DisplayBatch" />. The point is preprocessing: meshing/quantizing/compressing
///     a part once, saving the finished blob, then reloading it cheaply (no re-mesh) when the same
///     part is reused many times in a scene.
///
///     A file IS an SLVM v2 container (see <see cref="SlvmDocument" /> for the byte spec) — the
///     wire blob plus the item chunks (curves, points, their Rhino curve JSON). There is no
///     separate on-disk wrapper. The geometry blob is copied verbatim, never re-encoded, so
///     save/load adds no quantization or compression cost. It does NOT store the original
///     Breps/NURBS — it's a display artifact, not a CAD-exchange format.
/// </summary>
public static class SlvmFile
{
    public const string Extension = ".slvm";

    public static void Write(Stream output, DisplayBatch batch)
    {
        if (output == null)
        {
            throw new ArgumentNullException(nameof(output));
        }

        if (batch == null)
        {
            throw new ArgumentNullException(nameof(batch));
        }

        // The wire blob is already an SLVM container without item chunks; the file is the same
        // container with them. Rebuild from the batch so items, curve JSON and the id all land in
        // their chunks; the geometry blob is copied verbatim, never re-encoded.
        byte[] geometryBlob = null;
        if (batch.CompressedData != null && batch.CompressedData.Length > 0)
        {
            geometryBlob = SlvmDocument.IsSlvm(batch.CompressedData)
                ? SlvmDocument.Read(batch.CompressedData).GeometryBlob
                : batch.CompressedData; // legacy SLVA/SLVZ blob from an old .gh — adopt as-is
        }

        var fileBytes = SlvmDocument.Write(batch, geometryBlob, includeItems: true);
        output.Write(fileBytes, 0, fileBytes.Length);
    }

    public static DisplayBatch Read(Stream input)
    {
        if (input == null)
        {
            throw new ArgumentNullException(nameof(input));
        }

        using (var buffer = new MemoryStream())
        {
            input.CopyTo(buffer);
            var bytes = buffer.ToArray();

            if (!SlvmDocument.IsSlvm(bytes))
            {
                throw new InvalidDataException("Not an SLVM file (bad magic).");
            }

            var doc = SlvmDocument.Read(bytes);
            // In-memory CompressedData is the wire shape: items travel as JSON alongside, so
            // strip their chunks or a re-broadcast would carry them twice.
            doc.Batch.CompressedData = SlvmDocument.StripItems(bytes, doc.Batch.BatchId);
            return doc.Batch;
        }
    }
}
