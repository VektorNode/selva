using System;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

/// <summary>
///     The binary frame a file travels in between the Rhino panel and the plugin. The fixture
///     host-picked-file.slhf is read by the page's codec too (host-frame.test.ts): its header is
///     host-picked-file.json, and its body is every byte value 0–255 once, in order.
///
///     Regenerate after an intentional change:
///         UPDATE_WIRE_FIXTURES=1 dotnet test --filter HostFileFrameTests
/// </summary>
public class HostFileFrameTests
{
    private static readonly JsonSerializerSettings TransportSettings = new JsonSerializerSettings
    {
        TypeNameHandling = TypeNameHandling.None,
        MetadataPropertyHandling = MetadataPropertyHandling.Ignore
    };

    internal static object SampleHeader()
    {
        return OutboundEnvelopes.HostPickedFile("session-fixture", "8", "facade.3dm");
    }

    private static byte[] SampleBody()
    {
        return Enumerable.Range(0, 256).Select(i => (byte)i).ToArray();
    }

    [Fact]
    public void Encode_ThenDecode_GivesBackHeaderAndBody()
    {
        var frame = HostFileFrame.Encode("{\"type\":\"hostSaveFile\"}", SampleBody());

        Assert.True(HostFileFrame.TryDecode(frame, out var header, out var body));
        Assert.Equal("{\"type\":\"hostSaveFile\"}", header);
        Assert.Equal(SampleBody(), body.ToArray());
    }

    [Fact]
    public void Decode_AnEmptyBody_IsAllowed()
    {
        var frame = HostFileFrame.Encode("{\"type\":\"hostSaveFile\"}", Array.Empty<byte>());

        Assert.True(HostFileFrame.TryDecode(frame, out _, out var body));
        Assert.Equal(0, body.Count);
    }

    [Fact]
    public void Decode_RefusesAnythingButAWholeFrame()
    {
        var good = HostFileFrame.Encode("{}", new byte[] { 1 });

        var wrongMagic = (byte[])good.Clone();
        wrongMagic[3] = (byte)'A'; // SLHA, not SLHF: a mesh blob starts SLVA

        var lengthPastTheEnd = (byte[])good.Clone();
        lengthPastTheEnd[4] = 0xFF;

        var emptyHeader = (byte[])good.Clone();
        Array.Clear(emptyHeader, 4, 4);

        foreach (var frame in new[] { wrongMagic, lengthPastTheEnd, emptyHeader, good.Take(7).ToArray(), Array.Empty<byte>() })
        {
            Assert.False(HostFileFrame.TryDecode(frame, out _, out _));
        }
    }

    [Fact]
    public void Fixture_MatchesTheEncodedSample()
    {
        var path = Path.Combine(TestPaths.RepoRoot(), "packages", "schemas", "fixtures", "wire", "host-picked-file.slhf");
        var produced = HostFileFrame.Encode(JsonConvert.SerializeObject(SampleHeader(), TransportSettings), SampleBody());

        if (Environment.GetEnvironmentVariable("UPDATE_WIRE_FIXTURES") == "1")
        {
            File.WriteAllBytes(path, produced);
            return;
        }

        Assert.True(File.Exists(path), "host-picked-file.slhf missing — run UPDATE_WIRE_FIXTURES=1 dotnet test");
        Assert.Equal(produced, File.ReadAllBytes(path));

        Assert.True(HostFileFrame.TryDecode(File.ReadAllBytes(path), out var header, out var body));
        Assert.Equal("SLHF", Encoding.ASCII.GetString(produced, 0, 4));
        Assert.True(JToken.DeepEquals(JObject.FromObject(SampleHeader()), JObject.Parse(header)));
        Assert.Equal(SampleBody(), body.ToArray());
    }
}
