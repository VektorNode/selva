using System;
using System.IO;
using System.Text;
using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Reads and writes the Selva Display Mesh File (<c>.dmf</c>) — a self-contained, on-disk copy
///     of a <see cref="DisplayBatch" />. The point is preprocessing: meshing/quantizing/compressing
///     a part once, saving the finished blob, then reloading it cheaply (no re-mesh) when the same
///     part is reused many times in a scene.
///
///     The file is self-contained at mesh-display fidelity: it stores the already-encoded SLVA/SLVZ
///     geometry blob verbatim plus a JSON sidecar for everything else on the batch. It does NOT
///     store the original Breps/NURBS — it's a display artifact, not a CAD-exchange format.
///
///     Wire format (little-endian):
///
///     [4]  magic   = "DMF1" (0x44 0x4D 0x46 0x31)
///     [4]  version = uint32 (currently 1)
///     [4]  jsonLen = uint32 byte length of the UTF-8 sidecar JSON
///     [N]  json    = sidecar: { materials, groups, items, sourceComponentId }
///     [M]  blob    = raw SLVA/SLVZ bytes (DisplayBatch.CompressedData), to end of file
///
///     The blob is written verbatim and never re-encoded, so save/load adds no quantization or
///     compression cost — it's a byte copy on each side.
/// </summary>
public static class DmfFile
{
    public const uint Magic = 0x31464D44; // "DMF1" little-endian
    public const uint Version = 1;

    public const string Extension = ".dmf";

    /// <summary>
    ///     The non-blob parts of a <see cref="DisplayBatch" />. Serialized as the file's JSON sidecar
    ///     so the blob can stay raw bytes. Property names mirror the batch's own JSON shape.
    /// </summary>
    private sealed class Sidecar
    {
        [JsonProperty("materials")] public object Materials { get; set; }
        [JsonProperty("groups")] public object Groups { get; set; }
        [JsonProperty("items")] public object Items { get; set; }
        [JsonProperty("sourceComponentId")] public string SourceComponentId { get; set; }
    }

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

        var sidecar = new Sidecar
        {
            Materials = batch.Materials,
            Groups = batch.Groups,
            Items = batch.Items,
            SourceComponentId = batch.SourceComponentId
        };

        var jsonBytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(sidecar));
        var blob = batch.CompressedData ?? new byte[0];

        using (var writer = new BinaryWriter(output, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write(Magic);
            writer.Write(Version);
            writer.Write((uint)jsonBytes.Length);
            writer.Write(jsonBytes);
            writer.Write(blob);
        }
    }

    public static DisplayBatch Read(Stream input)
    {
        if (input == null)
        {
            throw new ArgumentNullException(nameof(input));
        }

        using (var reader = new BinaryReader(input, Encoding.UTF8, leaveOpen: true))
        {
            var magic = reader.ReadUInt32();
            if (magic != Magic)
            {
                throw new InvalidDataException($"Not a DMF file (bad magic 0x{magic:X8}).");
            }

            var version = reader.ReadUInt32();
            if (version != Version)
            {
                throw new InvalidDataException($"Unsupported DMF version {version} (expected {Version}).");
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
