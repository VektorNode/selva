using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

namespace Selva.Drawing.Rendering.Svg;

// Resolves bundled fonts to base64 data URIs for `@font-face` embedding. Only loads the
// binary; emitting the `<style>@font-face{...}</style>` block is the renderer's call,
// gated by SvgRenderOptions.EmbedFonts.
public static class SvgFontResolver
{
	private const string ResourcePrefix = "Selva.Drawing.Fonts.Resources.";

	private static readonly Dictionary<string, string> KnownFonts = new()
	{
		// SVG @font-face needs (family, weight, style) tuples. Both bundled fonts are Inter;
		// weight is the only distinguishing axis.
		[$"{ResourcePrefix}Inter-Regular.ttf"] = "Inter|400|normal",
		[$"{ResourcePrefix}Inter-Bold.ttf"] = "Inter|700|normal",
	};

	public sealed class EmbeddedFont
	{
		public string Family { get; init; } = string.Empty;
		public int Weight { get; init; } = 400;
		public string Style { get; init; } = "normal";
		public string DataUri { get; init; } = string.Empty;
	}

	public static IReadOnlyList<EmbeddedFont> LoadAll()
	{
		var assembly = typeof(SvgFontResolver).Assembly;
		var fonts = new List<EmbeddedFont>();
		foreach (var kv in KnownFonts)
		{
			var font = TryLoad(assembly, kv.Key, kv.Value);
			if (font != null) fonts.Add(font);
		}
		return fonts;
	}

	private static EmbeddedFont TryLoad(Assembly assembly, string resourceName, string descriptor)
	{
		using var stream = assembly.GetManifestResourceStream(resourceName);
		if (stream == null) return null;

		var buffer = new byte[stream.Length];
		var read = 0;
		while (read < buffer.Length)
		{
			var n = stream.Read(buffer, read, buffer.Length - read);
			if (n <= 0) break;
			read += n;
		}

		var parts = descriptor.Split('|');
		var weight = int.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);

		return new EmbeddedFont
		{
			Family = parts[0],
			Weight = weight,
			Style = parts[2],
			DataUri = "data:font/ttf;base64," + Convert.ToBase64String(buffer),
		};
	}
}
