using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Tests.Model;

// Two purposes here:
// 1. Compile-time: implementing IElementVisitor without missing a method means every
//    element kind in the model has a visitor slot. If anyone adds a new element later
//    without extending the visitor, this file stops compiling — that's the safety net
//    the plan calls out under "visitor pattern with compiler-enforced completeness."
// 2. Run-time: each Accept(visitor) must dispatch to the matching Visit(...) overload.
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
