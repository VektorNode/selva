using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using PdfSharpCore.Fonts;

namespace Selva.Drawing.Rendering.Pdf;

// Bridges Selva's bundled Inter fonts into PdfSharpCore's global IFontResolver. PdfSharpCore
// requires the resolver to be set once before any XFont is constructed and refuses to swap
// it out later, so the install routine is idempotent: the first PdfRenderer wins, and
// subsequent calls are no-ops as long as the same instance is already registered.
//
// Face name = the lookup key we hand back through ResolveTypeface and that PdfSharpCore
// then uses to call GetFont. We use the embedded resource name verbatim so GetFont can
// just stream the resource back.
internal sealed class PdfFontEmbedder : IFontResolver
{
	private const string ResourcePrefix = "Selva.Drawing.Fonts.Resources.";
	private const string DefaultFamily = "Inter";
	// Face names used as PdfSharpCore's font cache keys. Simple identifiers, no path
	// characters — those confuse PdfSharp's font dictionary key handling and trip up
	// downstream subsetting.
	private const string RegularFace = "Inter-Regular";
	private const string BoldFace = "Inter-Bold";
	private const string RegularResource = ResourcePrefix + "Inter-Regular.ttf";
	private const string BoldResource = ResourcePrefix + "Inter-Bold.ttf";

	private static readonly object InstallLock = new object();
	private static PdfFontEmbedder _installed;

	// Concurrent: the embedder is a process-wide singleton and GetFont can be hit from
	// parallel renders.
	private readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte[]> _faceData =
		new System.Collections.Concurrent.ConcurrentDictionary<string, byte[]>(StringComparer.Ordinal);
	// When another IFontResolver was already in place (e.g. Rhino installs one that maps
	// unknown families to AcadEref.ttf), we wrap it: Inter requests go to us, everything
	// else delegates so the host's font setup keeps working.
	private readonly IFontResolver _next;

	public PdfFontEmbedder() : this(null) { }
	private PdfFontEmbedder(IFontResolver next) { _next = next; }

	public string DefaultFontName => DefaultFamily;

	// Idempotent install. Safe to call from every PdfRenderer.Render(). If another
	// resolver is already in place we wrap it so Inter requests are handled here and
	// other families delegate to the foreign resolver. Without this wrap, hosts like
	// Rhino that install their own resolver would intercept "Inter" first and substitute
	// a fallback (we observed AcadEref.ttf) — giving every character glyph 0 / .notdef.
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
				// PdfSharpCore refuses to swap an in-use resolver. Fall back: keep the
				// foreign resolver but cache our wrap so subsequent installs are no-ops.
				// In this case "Inter" will fall through to the host's substitution —
				// not great, but at least we don't crash.
				_installed = wrap;
			}
		}
	}

	public FontResolverInfo ResolveTypeface(string familyName, bool isBold, bool isItalic)
	{
		// Inter is bundled — handle it here, regardless of what the foreign resolver
		// would say. (Rhino's resolver claims Inter and substitutes AcadEref.ttf, which
		// is why we wrap rather than return null on mismatch.)
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
			// Not one of ours — pass through to the wrapped resolver.
			if (_next != null) return _next.GetFont(faceName);
			throw new FileNotFoundException($"Unknown font face requested: {faceName}");
		}

		var bytes = LoadResource(resourceName);
		_faceData[faceName] = bytes;
		return bytes;
	}

	private static bool MatchesInter(string familyName)
	{
		// Accept "Inter", "Inter, sans-serif", "'Inter', Helvetica" — the same comma stack
		// FontMetrics tolerates.
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
