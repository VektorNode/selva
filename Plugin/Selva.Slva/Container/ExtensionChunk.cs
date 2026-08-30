using System.IO;
using System.Text;

namespace Selva.Slva;

/// <summary>
///     The EXTN chunk payload: [varint nsLen][namespace utf8][payload bytes]. The namespace names
///     the host that wrote it ("selva.gh", "myapp"); readers ignore namespaces they don't know.
/// </summary>
internal static class ExtensionChunk
{
    public static byte[] Encode(string ns, byte[] payload)
    {
        var nsBytes = Encoding.UTF8.GetBytes(ns);
        using (var ms = new MemoryStream())
        {
            Varint.Write(ms, (uint)nsBytes.Length);
            ms.Write(nsBytes, 0, nsBytes.Length);
            ms.Write(payload, 0, payload.Length);
            return ms.ToArray();
        }
    }

    public static (string ns, byte[] payload) Decode(byte[] chunkPayload)
    {
        var pos = 0;
        var nsLen = (int)Varint.Read(chunkPayload, ref pos);
        var ns = Encoding.UTF8.GetString(chunkPayload, pos, nsLen);
        pos += nsLen;
        var payload = new byte[chunkPayload.Length - pos];
        System.Buffer.BlockCopy(chunkPayload, pos, payload, 0, payload.Length);
        return (ns, payload);
    }
}
