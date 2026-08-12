using System;
using System.Collections.Generic;

namespace Selva.Drawing.Model.Layout;

// Document-wide token values (e.g. {project}, {client}, {rev}) resolved into
// DocumentLayout.Tokens, so header/footer/title-block text can reference them.
//
// Keys are case-folded to match TokenResolver, which lower-cases token names before lookup.
public sealed class DocumentInfo
{
	public IReadOnlyDictionary<string, string> Tokens { get; }

	public DocumentInfo(IReadOnlyDictionary<string, string> tokens)
	{
		Tokens = tokens ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
	}

	// Later entries win on duplicate keys; empty/blank keys are skipped.
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
