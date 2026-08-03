using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Tests.Model;

// RecordingVisitor implements IElementVisitor exhaustively, so adding an element kind
// without a matching Visit overload breaks the build. The theory below then checks that
// Accept actually routes to that overload at runtime.
public class VisitorDispatchTests
{
	private sealed class RecordingVisitor : IElementVisitor
	{
		public Type? LastVisited;

		public void Visit(PathElement element) => LastVisited = typeof(PathElement);
		public void Visit(TextElement element) => LastVisited = typeof(TextElement);
		public void Visit(TextBlockElement element) => LastVisited = typeof(TextBlockElement);
		public void Visit(ImageElement element) => LastVisited = typeof(ImageElement);
		public void Visit(GroupElement element) => LastVisited = typeof(GroupElement);
		public void Visit(DimensionElement element) => LastVisited = typeof(DimensionElement);
		public void Visit(LeaderElement element) => LastVisited = typeof(LeaderElement);
		public void Visit(HatchElement element) => LastVisited = typeof(HatchElement);
		public void Visit(SymbolElement element) => LastVisited = typeof(SymbolElement);
	}

	public static IEnumerable<object[]> AllElements()
	{
		yield return new object[] { new PathElement() };
		yield return new object[] { new TextElement() };
		yield return new object[] { new TextBlockElement() };
		yield return new object[] { new ImageElement() };
		yield return new object[] { new GroupElement() };
		yield return new object[] { new DimensionElement() };
		yield return new object[] { new LeaderElement() };
		yield return new object[] { new HatchElement() };
		yield return new object[] { new SymbolElement() };
	}

	[Theory]
	[MemberData(nameof(AllElements))]
	public void Accept_dispatches_to_matching_visitor_method(DrawElement element)
	{
		var visitor = new RecordingVisitor();
		element.Accept(visitor);
		Assert.Equal(element.GetType(), visitor.LastVisited);
	}

	[Fact]
	public void Accept_throws_when_visitor_is_null()
	{
		Assert.Throws<ArgumentNullException>(() => new PathElement().Accept(null));
	}
}
