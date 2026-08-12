using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Substitutes header/footer tokens. Built-ins are evaluated per page so {page} reflects the
// current page; {pages} needs the total count, so construct one resolver per page once both
// numbers are known.
//
// Pattern: {name} or {name:argument}. Letters only in the name; argument runs to the next
// `}`. Unknown tokens pass through unchanged so legitimate braces in user text survive.
public sealed class TokenResolver
{
	private static readonly Regex Pattern = new Regex(
		@"\{([a-zA-Z]+)(?::([^}]+))?\}",
		RegexOptions.Compiled);

	private readonly int _page;
	private readonly int _totalPages;
	private readonly DateTime _now;
	private readonly string _title;
	private readonly string _section;
	private readonly IReadOnlyDictionary<string, string> _userTokens;
	private readonly CultureInfo _culture;

	public TokenResolver(
		int page,
		int totalPages,
		string title,
		string section = null,
		IReadOnlyDictionary<string, string> userTokens = null,
		DateTime? now = null,
		CultureInfo culture = null)
	{
		_page = page;
		_totalPages = totalPages;
		_title = title ?? string.Empty;
		_section = section ?? string.Empty;
		_userTokens = userTokens;
		_now = now ?? DateTime.Now;
		// Drives localized {date} month/day names (e.g. de-DE → "Juni", "Dienstag"); numeric
		// formats like dd.MM.yyyy don't vary by culture.
		_culture = culture ?? CultureInfo.InvariantCulture;
	}

	public string Resolve(string input)
	{
		if (string.IsNullOrEmpty(input)) return input;
		return Pattern.Replace(input, Substitute);
	}

	// Walks a resolved DrawElement subtree, returning a clone where every TextElement /
	// TextBlockElement / TextFlow has its Text run through Resolve. GroupElement rebuilds
	// recursively; other primitives pass through (no user-visible strings).
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
			case TextFlow f:
				{
					// TextFlow carries text before line-breaking, so tokens must substitute
					// here — before layout — so the substituted value is what gets wrapped
					// and measured, not just the TextElements it eventually produces.
					var resolved = Resolve(f.Text);
					if (ReferenceEquals(resolved, f.Text)) return f;
					return new TextFlow
					{
						Id = f.Id,
						CssClass = f.CssClass,
						Metadata = f.Metadata,
						Text = resolved,
						Width = f.Width,
						Style = f.Style,
						Origin = f.Origin,
						FixedHeight = f.FixedHeight,
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
						PreviewOnly = g.PreviewOnly,
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
					? _now.ToString(arg, _culture)
					: _now.ToString("yyyy-MM-dd", _culture);
			case "title":
				return _title;
			case "section":
				return _section;
			default:
				if (_userTokens != null && _userTokens.TryGetValue(name, out var v)) return v ?? string.Empty;
				return m.Value;
		}
	}
}
