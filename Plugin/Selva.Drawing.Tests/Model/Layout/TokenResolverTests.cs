using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class TokenResolverTests
{
	[Fact]
	public void Page_token_substitutes_current_page_number()
	{
		var r = new TokenResolver(3, 7, "doc");
		Assert.Equal("Page 3", r.Resolve("Page {page}"));
	}

	[Fact]
	public void Pages_token_substitutes_total_count()
	{
		var r = new TokenResolver(1, 12, "doc");
		Assert.Equal("of 12", r.Resolve("of {pages}"));
	}

	[Fact]
	public void Date_token_default_is_ISO()
	{
		var fixedNow = new DateTime(2026, 5, 1);
		var r = new TokenResolver(1, 1, null, null, fixedNow);
		Assert.Equal("2026-05-01", r.Resolve("{date}"));
	}

	[Fact]
	public void Date_token_with_format_argument_uses_DotNet_format_string()
	{
		var fixedNow = new DateTime(2026, 5, 1);
		var r = new TokenResolver(1, 1, null, null, fixedNow);
		Assert.Equal("01 May 2026", r.Resolve("{date:dd MMM yyyy}"));
	}

	[Fact]
	public void Title_token_substitutes_template_title()
	{
		var r = new TokenResolver(1, 1, "Q2 Report");
		Assert.Equal("Q2 Report — draft", r.Resolve("{title} — draft"));
	}

	[Fact]
	public void Title_token_with_null_title_substitutes_empty_string()
	{
		var r = new TokenResolver(1, 1, null);
		Assert.Equal("[]", r.Resolve("[{title}]"));
	}

	[Fact]
	public void User_tokens_substitute_by_name()
	{
		var tokens = new Dictionary<string, string> { ["author"] = "Felix", ["rev"] = "B" };
		var r = new TokenResolver(1, 1, null, tokens);
		Assert.Equal("by Felix rev B", r.Resolve("by {author} rev {rev}"));
	}

	[Fact]
	public void Unknown_token_is_passed_through_unchanged()
	{
		var r = new TokenResolver(1, 1, null);
		Assert.Equal("hello {nope}", r.Resolve("hello {nope}"));
	}

	[Fact]
	public void Builtin_token_wins_over_user_token_with_same_name()
	{
		var tokens = new Dictionary<string, string> { ["page"] = "OVERRIDE" };
		var r = new TokenResolver(5, 9, null, tokens);
		Assert.Equal("5", r.Resolve("{page}"));
	}

	[Fact]
	public void Multiple_tokens_in_one_string()
	{
		var r = new TokenResolver(2, 5, "Report");
		Assert.Equal("Report — Page 2 of 5", r.Resolve("{title} — Page {page} of {pages}"));
	}

	[Fact]
	public void ResolveTree_clones_TextElement_with_substituted_text()
	{
		var original = new TextElement { Text = "Page {page}", Position = new Point2D(1, 2) };
		var r = new TokenResolver(4, 10, null);
		var resolved = r.ResolveTree(original);
		var t = Assert.IsType<TextElement>(resolved);
		Assert.Equal("Page 4", t.Text);
		Assert.Equal(original.Position, t.Position);
		Assert.NotSame(original, t);
	}

	[Fact]
	public void ResolveTree_clones_TextBlockElement_with_substituted_text()
	{
		var original = new TextBlockElement
		{
			Text = "Total: {pages}",
			Box = new BoundingBox(0, 0, 10, 5),
			Style = new TextStyle(),
		};
		var r = new TokenResolver(1, 8, null);
		var resolved = r.ResolveTree(original);
		var b = Assert.IsType<TextBlockElement>(resolved);
		Assert.Equal("Total: 8", b.Text);
		Assert.NotSame(original, b);
	}

	[Fact]
	public void ResolveTree_passes_non_text_primitives_through_unchanged()
	{
		var path = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(1, 0).Build(),
		};
		var r = new TokenResolver(1, 1, null);
		Assert.Same(path, r.ResolveTree(path));
	}

	[Fact]
	public void ResolveTree_recurses_into_GroupElement_children()
	{
		var inner = new TextElement { Text = "{page}/{pages}", Position = Point2D.Zero };
		var group = new GroupElement { Children = new DrawElement[] { inner } };
		var r = new TokenResolver(2, 4, null);
		var resolved = r.ResolveTree(group);
		var g = Assert.IsType<GroupElement>(resolved);
		var t = Assert.IsType<TextElement>(g.Children[0]);
		Assert.Equal("2/4", t.Text);
		Assert.NotSame(group, g);
	}

	[Fact]
	public void ResolveTree_returns_same_GroupElement_when_no_descendants_change()
	{
		var path = new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(1, 1).Build() };
		var group = new GroupElement { Children = new DrawElement[] { path } };
		var r = new TokenResolver(1, 1, null);
		Assert.Same(group, r.ResolveTree(group));
	}
}
