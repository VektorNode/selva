using System;
using System.IO;
using System.Text;
using Newtonsoft.Json;

namespace Selva.Slva;

/// <summary>
///     Reads and writes the Selva mesh file (<c>.slvm</c>; legacy <c>.dmf</c> read-only) — a
///     self-contained, on-disk copy of a <see cref="DisplayBatch" />. The point is preprocessing:
///     meshing/quantizing/compressing a part once, saving the finished blob, then reloading it
///     cheaply (no re-mesh) when the same part is reused many times in a scene.
///
///     A file IS an SLVM v2 container (see <see cref="SlvmDocument" /> for the byte spec) — the
///     wire blob plus the item chunks (curves, points, their Rhino curve JSON). There is no
///     separate on-disk wrapper. The geometry blob is copied verbatim, never re-encoded, so
///     save/load adds no quantization or compression cost. It does NOT store the original
///     Breps/NURBS — it's a display artifact, not a CAD-exchange format.
///
///     Files written before SLVM v2 use the DMF1 container (a JSON sidecar in front of the blob);
///     the reader dispatches on the leading magic and accepts them forever. Nothing else knows
///     DMF1 exists: the writer emits only SLVM v2.
/// </summary>
public static class SlvmFile
{
    public const string Extension = ".slvm";

    /// <summary>Legacy DMF1 container magic, read-only. New files carry <see cref="SlvmDocument.Magic" />.</summary>
    public const uint LegacyMagic = 0x31464D44; // "DMF1" little-endian
    private const uint LegacyVersion = 1;

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

            if (SlvmDocument.IsSlvm(bytes))
            {
                var doc = SlvmDocument.Read(bytes);
                // In-memory CompressedData is the wire shape: items travel as JSON alongside, so
                // strip their chunks or a re-broadcast would carry them twice.
                doc.Batch.CompressedData = SlvmDocument.StripItems(bytes);
                return doc.Batch;
            }

            return ReadLegacy(bytes);
        }
    }

    /// <summary>The DMF1 container (files written before SLVM v2). Read-only forever.</summary>
    private static DisplayBatch ReadLegacy(byte[] bytes)
    {
        using (var input = new MemoryStream(bytes, false))
        using (var reader = new BinaryReader(input, Encoding.UTF8, leaveOpen: true))
        {
            var magic = reader.ReadUInt32();
            if (magic != LegacyMagic)
            {
                throw new InvalidDataException($"Not a Selva mesh file (bad magic 0x{magic:X8}).");
            }

            var version = reader.ReadUInt32();
            if (version != LegacyVersion)
            {
                throw new InvalidDataException($"Unsupported DMF version {version} (expected {LegacyVersion}).");
            }

            var jsonLen = reader.ReadUInt32();
            var jsonBytes = reader.ReadBytes((int)jsonLen);
            var json = Encoding.UTF8.GetString(jsonBytes);

            // Deserialize straight into a DisplayBatch shape: the sidecar property names match, and
            // the blob fills in CompressedData below. Reusing the batch's own JSON contract keeps the
            // round-trip lossless without a second mapping layer.
            var batch = JsonConvert.DeserializeObject<DisplayBatch>(json) ?? new DisplayBatch();

            // Remaining bytes are the raw SLVA/SLVZ blob. Read through the BinaryReader (not the raw
            // stream) so we don't lose any bytes the reader buffered ahead.
            using (var ms = new MemoryStream())
            {
                var chunk = new byte[8192];
                int read;
                while ((read = reader.Read(chunk, 0, chunk.Length)) > 0)
                {
                    ms.Write(chunk, 0, read);
                }

                batch.CompressedData = ms.ToArray();
            }

            return batch;
        }
    }
}
