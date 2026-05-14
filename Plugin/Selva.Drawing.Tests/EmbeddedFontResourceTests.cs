using System.Linq;
using System.Reflection;
using Selva.Drawing.Model;

namespace Selva.Drawing.Tests;

public class EmbeddedFontResourceTests
{
	[Theory]
	[InlineData("Selva.Drawing.Fonts.Resources.Inter-Regular.ttf")]
	[InlineData("Selva.Drawing.Fonts.Resources.Inter-Bold.ttf")]
	public void Inter_font_is_embedded_in_assembly(string resourceName)
	{
		var assembly = typeof(Document).Assembly;
		var names = assembly.GetManifestResourceNames();

		Assert.Contains(resourceName, names);

		using var stream = assembly.GetManifestResourceStream(resourceName);
		Assert.NotNull(stream);
		Assert.True(stream!.Length > 100_000, $"{resourceName} is suspiciously small ({stream.Length} bytes)");
	}
}
