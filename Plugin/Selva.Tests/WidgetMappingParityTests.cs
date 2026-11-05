using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.Tests;

/// <summary>
///     The widget a param type gets, pinned in one fixture that plugin-ui's
///     widget-mapping-parity.test.ts reads too: a param placed from the canvas or a script must get
///     the widget a drag in the editor gives it.
/// </summary>
public class WidgetMappingParityTests
{
    private static JObject Fixture() => JObject.Parse(File.ReadAllText(
        Path.Combine(TestPaths.RepoRoot(), "packages", "schemas", "fixtures", "widget-mapping.json")));

    [Fact]
    public void EveryParamTypeOfTheSchema_IsInTheFixture()
    {
        var schema = JObject.Parse(File.ReadAllText(
            Path.Combine(TestPaths.RepoRoot(), "packages", "schemas", "ui-schema.json")));
        var types = schema["definitions"]!["ParamType"]!["enum"]!.Values<string>();

        Assert.Equal(types.OrderBy(t => t), ((JObject)Fixture()["inputs"]!).Properties().Select(p => p.Name).OrderBy(t => t));
    }

    [Fact]
    public void LayoutSpec_MapsTypesAsTheFixtureSays()
    {
        var fixture = Fixture();
        foreach (var (side, isOutput) in new[] { ("inputs", false), ("outputs", true) })
        {
            foreach (var pair in (JObject)fixture[side]!)
            {
                Assert.True((string)pair.Value! == LayoutSpec.DefaultWidgetFor(pair.Key, isOutput),
                    $"{side}.{pair.Key}: fixture says {pair.Value}, LayoutSpec says {LayoutSpec.DefaultWidgetFor(pair.Key, isOutput)}");
            }
        }
    }
}
