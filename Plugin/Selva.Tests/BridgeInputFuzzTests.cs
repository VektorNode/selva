using System;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Xunit;

namespace Selva.Tests;

/// <summary>
///     Random input against the two decoders every page message passes through. Both promise never to
///     throw on bad input: the parser maps it to an <see cref="InboundKind" />, the frame decoder returns
///     false. An exception escaping either is swallowed by the transport's catch-all, so the page's
///     request just never gets an answer. Seeded, so a failure reproduces.
/// </summary>
public class BridgeInputFuzzTests
{
    private const string Session = "session-1";
    private const int Runs = 5000;

    private static readonly string[] Types =
    {
        "valueUpdate", "requestCurrentValues", "cancelSolve", "requestInitialData", "saveSchema",
        "requestSyncPreview", "applySyncChanges", "selvaGetAccount", "selvaConnect", "selvaSignIn",
        "selvaUseApiKey", "selvaSignOut", "selvaListTargets", "selvaUpload", "selvaCancel", "hostSaveFile",
        "hostPickFile", "pickGeometry", "clearGeometry", "trigger", "closeDefinition", "editInGrasshopper",
        "nope"
    };

    private static readonly string[] Fields =
    {
        "accept", "baseSchemaHash", "changes", "fileName", "origin", "paramId", "request", "requestId",
        "schema", "schemaOnly", "values", "inputs", "id", "x"
    };

    private static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            TypeNameHandling = TypeNameHandling.None,
            MetadataPropertyHandling = MetadataPropertyHandling.Ignore
        });

    [Fact]
    public void Parse_NeverThrows_OnRandomMessages()
    {
        var random = new Random(20261027);
        var parser = new InboundMessageParser(Serializer);
        for (var i = 0; i < Runs; i++)
        {
            var message = RandomMessage(random);
            var json = random.Next(10) == 0 ? Mangle(random, message.ToString()) : message.ToString();

            var ex = Record.Exception(() => parser.Parse(json, Session));

            Assert.True(ex == null, $"Run {i} threw {ex?.GetType().Name}: {ex?.Message}\n{json}");
        }
    }

    [Fact]
    public void TryDecode_NeverThrows_OnRandomOrDamagedFrames()
    {
        var random = new Random(20261028);
        var valid = HostFileFrame.Encode(@"{""type"":""hostSaveFile""}", new byte[] { 1, 2, 3 });
        for (var i = 0; i < Runs; i++)
        {
            byte[] frame;
            if (random.Next(2) == 0)
            {
                frame = new byte[random.Next(0, 32)];
                random.NextBytes(frame);
            }
            else
            {
                frame = valid.Take(random.Next(0, valid.Length + 1)).ToArray();
                if (frame.Length > 0) frame[random.Next(frame.Length)] = (byte)random.Next(256);
            }

            var ex = Record.Exception(() => HostFileFrame.TryDecode(frame, out _, out _));

            Assert.True(ex == null, $"Run {i} threw {ex?.GetType().Name}: {BitConverter.ToString(frame)}");
        }
    }

    private static JObject RandomMessage(Random random)
    {
        var message = new JObject
        {
            ["type"] = Types[random.Next(Types.Length)],
            ["sessionId"] = random.Next(8) == 0 ? RandomValue(random, 0) : Session
        };
        var count = random.Next(0, 5);
        for (var i = 0; i < count; i++)
        {
            message[Fields[random.Next(Fields.Length)]] = RandomValue(random, 0);
        }

        return message;
    }

    private static JToken RandomValue(Random random, int depth)
    {
        switch (random.Next(depth > 2 ? 6 : 9))
        {
            case 0: return JValue.CreateNull();
            case 1: return new JValue(random.Next(2) == 0);
            case 2: return new JValue(random.Next(int.MinValue, int.MaxValue));
            case 3: return new JValue(random.NextDouble() * Math.Pow(10, random.Next(-5, 300)));
            case 4: return new JValue(RandomString(random));
            case 5:
                var bytes = new byte[16];
                random.NextBytes(bytes);
                return new JValue(new Guid(bytes).ToString());
            case 6:
                return new JArray(Enumerable.Range(0, random.Next(0, 4)).Select(_ => RandomValue(random, depth + 1)));
            default:
                var obj = new JObject();
                for (var i = random.Next(0, 4); i > 0; i--)
                {
                    obj[random.Next(2) == 0 ? Fields[random.Next(Fields.Length)] : RandomString(random)] =
                        RandomValue(random, depth + 1);
                }

                return obj;
        }
    }

    private static string RandomString(Random random)
    {
        var pieces = new[] { "", "a", "../", "\\", "\u0000", "{", "\"", "é", "{0}", "System.Double", "$type", "1e309" };
        var sb = new StringBuilder();
        for (var i = random.Next(0, 4); i > 0; i--) sb.Append(pieces[random.Next(pieces.Length)]);
        return sb.ToString();
    }

    /// <summary>Truncates or splices a character, so the JSON itself is malformed.</summary>
    private static string Mangle(Random random, string json)
    {
        var at = random.Next(json.Length);
        return random.Next(2) == 0 ? json.Substring(0, at) : json.Remove(at, 1).Insert(at, "\"{[");
    }
}
