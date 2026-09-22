using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using PdfSharpCore.Fonts;

namespace Selva.Drawing.Rendering.Pdf;

// Bridges Selva's bundled Inter fonts into PdfSharpCore's global IFontResolver. PdfSharpCore
// requires the resolver to be set once before any XFont is constructed and refuses to swap
// it out later, so install is idempotent: the first PdfRenderer wins, later calls are no-ops.
internal sealed class PdfFontEmbedder : IFontResolver
{
	private const string ResourcePrefix = "Selva.Drawing.Fonts.Resources.";
	private const string DefaultFamily = "Inter";
	// Simple identifiers, no path characters: those confuse PdfSharp's font dictionary
	// key handling and trip up downstream subsetting.
	private const string RegularFace = "Inter-Regular";
	private const string BoldFace = "Inter-Bold";
	private const string RegularResource = ResourcePrefix + "Inter-Regular.ttf";
	private const string BoldResource = ResourcePrefix + "Inter-Bold.ttf";

	private static readonly object InstallLock = new object();
	private static PdfFontEmbedder _installed;

	// The embedder is a process-wide singleton; GetFont can be hit from parallel renders.
	private readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte[]> _faceData =
		new System.Collections.Concurrent.ConcurrentDictionary<string, byte[]>(StringComparer.Ordinal);
	// Wraps whatever resolver was already installed (e.g. Rhino maps unknown families to
	// AcadEref.ttf) so Inter requests come here and everything else still delegates.
	private readonly IFontResolver _next;

	public PdfFontEmbedder() : this(null) { }
	private PdfFontEmbedder(IFontResolver next) { _next = next; }

	public string DefaultFontName => DefaultFamily;

	// Safe to call from every PdfRenderer.Render(). Without the wrap in the constructor,
	// a host resolver (Rhino installs one) would intercept "Inter" first and substitute a
	// fallback (observed: AcadEref.ttf): every character then renders as glyph 0 / .notdef.
	public static void EnsureInstalled()
	{
		if (_installed != null) return;
		lock (InstallLock)
		{
			if (_installed != null) return;
			var current = GlobalFontSettings.FontResolver;
			if (current is PdfFontEmbedder existing)
			{
				_installed = existing;
				return;
			}
			var wrap = new PdfFontEmbedder(current);
			try
			{
				GlobalFontSettings.FontResolver = wrap;
				_installed = wrap;
			}
			catch
			{
				// PdfSharpCore refuses to swap an in-use resolver. Cache our wrap anyway
				// so later installs are no-ops; Inter falls through to the host's
				// substitution here, but at least we don't crash.
				_installed = wrap;
			}
		}
	}

	public FontResolverInfo ResolveTypeface(string familyName, bool isBold, bool isItalic)
	{
		// Inter is bundled: always handle it here regardless of what the wrapped resolver says.
		if (!string.IsNullOrEmpty(familyName) && MatchesInter(familyName))
		{
			return new FontResolverInfo(
				isBold ? BoldFace : RegularFace,
				mustSimulateBold: false,
				mustSimulateItalic: isItalic);
		}

		// Anything else: delegate to the wrapped resolver if we have one. If we don't,
		// returning null lets PdfSharpCore fall through to its platform font cache.
		return _next?.ResolveTypeface(familyName, isBold, isItalic);
	}

	public byte[] GetFont(string faceName)
	{
		if (_faceData.TryGetValue(faceName, out var cached)) return cached;
		string resourceName = null;
		if (faceName == BoldFace) resourceName = BoldResource;
		else if (faceName == RegularFace) resourceName = RegularResource;

		if (resourceName == null)
		{
			if (_next != null) return _next.GetFont(faceName);
			throw new FileNotFoundException($"Unknown font face requested: {faceName}");
		}

		var bytes = LoadResource(resourceName);
		_faceData[faceName] = bytes;
		return bytes;
	}

	// Accepts "Inter", "Inter, sans-serif", "'Inter', Helvetica": the same comma stack
	// FontMetrics tolerates.
	private static bool MatchesInter(string familyName)
	{
		var first = familyName;
		var comma = familyName.IndexOf(',');
		if (comma >= 0) first = familyName.Substring(0, comma);
		first = first.Trim().Trim('"', '\'');
		return string.Equals(first, DefaultFamily, StringComparison.OrdinalIgnoreCase);
	}

	private static byte[] LoadResource(string resourceName)
	{
		var assembly = typeof(PdfFontEmbedder).Assembly;
		using var stream = assembly.GetManifestResourceStream(resourceName);
		if (stream == null) throw new FileNotFoundException($"Embedded font resource not found: {resourceName}");

		using var ms = new MemoryStream();
		stream.CopyTo(ms);
		return ms.ToArray();
	}
}
