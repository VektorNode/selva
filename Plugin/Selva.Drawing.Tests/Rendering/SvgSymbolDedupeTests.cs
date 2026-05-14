using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Svg;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering;

// Phase 10a: assert the structural contract of symbol dedupe — one <symbol> per
// unique Id regardless of instance count, and each instance emits a <use href="#id">
// rather than an inline copy of the children. The pinned snapshot covers byte-level
// stability; this file documents *why* the output looks that way.
public class SvgSymbolDedupeTests
{
	private static readonly SymbolDefinition Triangle = new SymbolDefinition
	{
		Id = "tri",
		Children = new DrawElement[]
		{
			new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(5, 0).LineTo(2.5, 4).Close().Build() },
		},
	};

	[Fact]
	public void Single_symbol_definition_emits_once_for_many_instances()
	{
		var svg = Render(new[]
		{
			new SymbolElement { Definition = Triangle, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = Triangle, Position = new Point2D(20, 0) },
			new SymbolElement { Definition = Triangle, Position = new Point2D(40, 0) },
		});

		Assert.Equal(1, CountOccurrences(svg, "<symbol id='tri'"));
		Assert.Equal(3, CountOccurrences(svg, "<use href='#tri'"));
		// The triangle's path data appears exactly once — inside the <symbol>, not inlined.
		Assert.Equal(1, CountOccurrences(svg, "M 0 0 L 5 0 L 2.5 4 Z"));
	}

	[Fact]
	public void Anonymous_definition_falls_back_to_inline_expansion()
	{
		// No Id → no entry in the dedupe map → renderer inlines children inside a <g>.
		var anon = new SymbolDefinition
		{
			Children = new DrawElement[]
			{
				new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(2, 0).Close().Build() },
			},
		};
		var svg = Render(new[]
		{
			new SymbolElement { Definition = anon, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = anon, Position = new Point2D(10, 0) },
		});

		Assert.DoesNotContain("<symbol", svg);
		Assert.DoesNotContain("<use ", svg);
		Assert.Equal(2, CountOccurrences(svg, "M 0 0 L 2 0 Z"));
	}

	[Fact]
	public void Two_definitions_with_same_id_throw()
	{
		var defA = new SymbolDefinition
		{
			Id = "shared",
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(1, 0).Build() } },
		};
		var defB = new SymbolDefinition
		{
			Id = "shared",
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(2, 0).Build() } },
		};
		Assert.Throws<System.InvalidOperationException>(() => Render(new[]
		{
			new SymbolElement { Definition = defA, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = defB, Position = new Point2D(10, 0) },
		}));
	}

	[Fact]
	public void Same_id_with_same_definition_does_not_throw()
	{
		// Reusing the same SymbolDefinition reference multiple times is the common case
		// — that's the whole point of dedupe and must not be flagged as a collision.
		var svg = Render(new[]
		{
			new SymbolElement { Definition = Triangle, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = Triangle, Position = new Point2D(10, 0) },
		});
		Assert.Equal(1, CountOccurrences(svg, "<symbol id='tri'"));
	}

	private static string Render(SymbolElement[] instances)
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page
				{
					Content = new GroupElement { Children = instances },
				},
			},
		};
		return new SvgRenderer(new SvgRenderOptions { Padding = 5.0 }).Render(doc);
	}

	private static int CountOccurrences(string s, string needle)
	{
		var count = 0;
		var i = 0;
		while ((i = s.IndexOf(needle, i, System.StringComparison.Ordinal)) >= 0)
		{
			count++;
			i += needle.Length;
		}
		return count;
	}
}
