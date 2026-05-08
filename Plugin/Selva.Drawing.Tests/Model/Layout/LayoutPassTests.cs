using System;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

// Phase 7: layout-pass behaviour. The renderer surface is unchanged — every LayoutElement
// must be resolved into primitive elements before it reaches a visitor.
public class LayoutPassTests
{
	[Fact]
	public void Bare_layout_element_throws_if_visited_directly()
	{
		var stack = new Stack { Children = new[] { MakeRectElement(10, 5) } };
		Assert.Throws<InvalidOperationException>(() => stack.Accept(new ThrowingVisitor()));
	}

	[Fact]
	public void Resolve_replaces_layout_with_primitives()
	{
		var stack = new Stack { Children = new[] { MakeRectElement(10, 5) } };
		var page = new Page { Content = stack };
		var resolved = LayoutPass.ResolvePage(page);
		Assert.NotSame(page, resolved);
		Assert.IsType<GroupElement>(resolved.Content);
	}

	[Fact]
	public void Resolve_preserves_pure_primitive_pages_by_reference()
	{
		var path = MakeRectElement(10, 5);
		var page = new Page { Content = path };
		var resolved = LayoutPass.ResolvePage(page);
		// No layout primitives → the page (and its content tree) should round-trip unchanged.
		Assert.Same(page, resolved);
	}

	[Fact]
	public void Resolve_recurses_through_groups_and_swaps_nested_layout_elements()
	{
		var nested = new GroupElement
		{
			Children = new DrawElement[]
			{
				MakeRectElement(10, 5),
				new Stack { Children = new[] { MakeRectElement(2, 2) } },
			},
		};
		var resolved = (GroupElement)LayoutPass.Resolve(nested, new LayoutContext(BoundingBox.Empty));
		Assert.Equal(2, resolved.Children.Count);
		Assert.IsType<PathElement>(resolved.Children[0]);
		Assert.IsType<GroupElement>(resolved.Children[1]);
	}

	private sealed class ThrowingVisitor : IElementVisitor
	{
		public void Visit(PathElement element) { }
		public void Visit(TextElement element) { }
		public void Visit(TextBlockElement element) { }
		public void Visit(ImageElement element) { }
		public void Visit(GroupElement element) { }
		public void Visit(DimensionElement element) { }
		public void Visit(LeaderElement element) { }
		public void Visit(HatchElement element) { }
		public void Visit(SymbolElement element) { }
	}

	internal static PathElement MakeRectElement(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
