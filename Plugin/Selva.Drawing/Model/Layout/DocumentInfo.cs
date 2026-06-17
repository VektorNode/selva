using System;
using System.Collections.Generic;

namespace Selva.Drawing.Model.Layout;

// A reusable bundle of document-wide field values — the "header file" / project-parameter set
// shared across Grasshopper definitions. Resolves into DocumentLayout.Tokens so any header,
// footer, title block, or body text can reference {project}, {client}, {rev}, … and have it
// substituted at render time. Define it once (a Document Info component) and wire the same
// value into every Document for unified output across files.
//
// Keys are case-folded to match the TokenResolver, which lower-cases token names before lookup.
public sealed class DocumentInfo
{
	public IReadOnlyDictionary<string, string> Tokens { get; }

	public DocumentInfo(IReadOnlyDictionary<string, string> tokens)
	{
		Tokens = tokens ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
	}

	// Build from paired key/value lists, lower-casing keys so {Project} and {project} both
	// resolve. Later entries win on duplicate keys. Empty/blank keys are skipped.
	public static DocumentInfo FromPairs(IReadOnlyList<string> keys, IReadOnlyList<string> values)
	{
		var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
		if (keys != null)
		{
			for (var i = 0; i < keys.Count; i++)
			{
				var key = keys[i]?.Trim();
				if (string.IsNullOrEmpty(key)) continue;
				var value = values != null && i < values.Count ? values[i] : string.Empty;
				map[key] = value ?? string.Empty;
			}
		}
		return new DocumentInfo(map);
	}
}
