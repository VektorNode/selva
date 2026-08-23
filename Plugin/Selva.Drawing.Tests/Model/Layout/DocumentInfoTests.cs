using System.Collections.Generic;
using Selva.Drawing.Model.Layout;

namespace Selva.Drawing.Tests.Model.Layout;

public class DocumentInfoTests
{
	[Fact]
	public void From_pairs_maps_keys_to_values_by_index()
	{
		var info = DocumentInfo.FromPairs(
			new[] { "project", "rev" },
			new[] { "Bracket", "B" });

		Assert.Equal("Bracket", info.Tokens["project"]);
		Assert.Equal("B", info.Tokens["rev"]);
	}

	[Fact]
	public void Keys_are_case_insensitive()
	{
		var info = DocumentInfo.FromPairs(new[] { "Project" }, new[] { "Bracket" });
		Assert.Equal("Bracket", info.Tokens["project"]);
		Assert.Equal("Bracket", info.Tokens["PROJECT"]);
	}

	[Fact]
	public void Unmatched_key_resolves_to_empty_string()
	{
		var info = DocumentInfo.FromPairs(new[] { "a", "b" }, new[] { "1" });
		Assert.Equal("1", info.Tokens["a"]);
		Assert.Equal("", info.Tokens["b"]);
	}

	[Fact]
	public void Blank_keys_are_skipped()
	{
		var info = DocumentInfo.FromPairs(new[] { "", "  ", "ok" }, new[] { "x", "y", "z" });
		Assert.Single(info.Tokens);
		Assert.Equal("z", info.Tokens["ok"]);
	}

	[Fact]
	public void Resolves_through_token_resolver()
	{
		var info = DocumentInfo.FromPairs(new[] { "project" }, new[] { "Acme" });
		var resolver = new TokenResolver(1, 1, null, userTokens: info.Tokens);
		Assert.Equal("Drawing for Acme", resolver.Resolve("Drawing for {project}"));
	}

	[Fact]
	public void Null_keys_yield_empty_info()
	{
		var info = DocumentInfo.FromPairs(null, null);
		Assert.Empty(info.Tokens);
	}
}
