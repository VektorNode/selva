using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Phase 8: substitutes header/footer tokens. Built-ins are evaluated per page so that
// {page} reflects the current page. {pages} requires the total page count, so the resolver
// is constructed once per page once both numbers are known.
//
// Pattern: {name} or {name:argument}. Letters only in the name; argument runs to the next
// `}`. Unknown tokens pass through unchanged so legitimate braces in user text aren't lost.
public sealed class TokenResolver
{
	private static readonly Regex Pattern = new Regex(
		@"\{([a-zA-Z]+)(?::([^}]+))?\}",
		RegexOptions.Compiled);

	private readonly int _page;
	private readonly int _totalPages;
	private readonly DateTime _now;
	private readonly string _title;
	private readonly IReadOnlyDictionary<string, string> _userTokens;

	public TokenResolver(
		int page,
		int totalPages,
		string title,
		IReadOnlyDictionary<string, string> userTokens = null,
		DateTime? now = null)
	{
		_page = page;
		_totalPages = totalPages;
		_title = title ?? string.Empty;
		_userTokens = userTokens;
		_now = now ?? DateTime.Now;
	}

	public string Resolve(string input)
	{
		if (string.IsNullOrEmpty(input)) return input;
		return Pattern.Replace(input, Substitute);
	}

	// Walks a resolved DrawElement subtree and returns a clone where every TextElement /
	// TextBlockElement has its Text run through Resolve. Containers (GroupElement) are
	// rebuilt recursively. Other primitives pass through unchanged because they don't carry
	// user-visible strings.
	public DrawElement ResolveTree(DrawElement element)
	{
		if (element == null) return null;

		switch (element)
		{
			case TextElement t:
				{
					var resolved = Resolve(t.Text);
					if (ReferenceEquals(resolved, t.Text)) return t;
					return new TextElement
					{
						Id = t.Id,
						CssClass = t.CssClass,
						Metadata = t.Metadata,
						Text = resolved,
						Position = t.Position,
						Style = t.Style,
						RotationDegrees = t.RotationDegrees,
						MeasuredBounds = t.MeasuredBounds,
						Hyperlink = t.Hyperlink,
					};
				}
			case TextBlockElement b:
				{
					var resolved = Resolve(b.Text);
					if (ReferenceEquals(resolved, b.Text)) return b;
					return new TextBlockElement
					{
						Id = b.Id,
						CssClass = b.CssClass,
						Metadata = b.Metadata,
						Text = resolved,
						Box = b.Box,
						Style = b.Style,
					};
				}
			case GroupElement g:
				{
					var children = g.Children;
					DrawElement[] cloned = null;
					for (var i = 0; i < children.Count; i++)
					{
						var c = children[i];
						var rc = ResolveTree(c);
						if (!ReferenceEquals(rc, c))
						{
							if (cloned == null)
							{
								cloned = new DrawElement[children.Count];
								for (var j = 0; j < i; j++) cloned[j] = children[j];
							}
							cloned[i] = rc;
						}
						else if (cloned != null)
						{
							cloned[i] = c;
						}
					}
					if (cloned == null) return g;
					return new GroupElement
					{
						Id = g.Id,
						CssClass = g.CssClass,
						Metadata = g.Metadata,
						Transform = g.Transform,
						BoundsOverride = g.BoundsOverride,
						Children = cloned,
					};
				}
			default:
				return element;
		}
	}

	private string Substitute(Match m)
	{
		var name = m.Groups[1].Value.ToLowerInvariant();
		var arg = m.Groups[2].Success ? m.Groups[2].Value : null;

		switch (name)
		{
			case "page":
				return _page.ToString(CultureInfo.InvariantCulture);
			case "pages":
				return _totalPages.ToString(CultureInfo.InvariantCulture);
			case "date":
				return arg != null
					? _now.ToString(arg, CultureInfo.InvariantCulture)
					: _now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
			case "title":
				return _title;
			default:
				if (_userTokens != null && _userTokens.TryGetValue(name, out var v)) return v ?? string.Empty;
				return m.Value;
		}
	}
}
