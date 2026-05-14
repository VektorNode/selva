using Selva.Drawing;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Rendering;

// Phase 3 contract: the dimension builders return a populated DimensionElement (or null
// for degenerate input). The renderer is responsible for the actual lines/arrows/text.
public class BuilderPipelineTests
{
	[Fact]
	public void LinearDimensionBuilder_packs_inputs_into_DimensionElement()
	{
		var style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.25 };
		var element = LinearDimensionBuilder.Build(0, 0, 100, 0, 10, "L", style);

		Assert.NotNull(element);
		Assert.Equal(DimensionKind.Linear, element!.Kind);
		Assert.Equal(new Point2D(0, 0), element.A);
		Assert.Equal(new Point2D(100, 0), element.B);
		Assert.Equal(10, element.Offset);
		Assert.Equal("L", element.Label);
		Assert.Same(style, element.Style);
	}

	[Fact]
	public void LinearDimensionBuilder_rejects_coincident_points()
	{
		var element = LinearDimensionBuilder.Build(5, 5, 5, 5, 10, null, new DimensionStyle());
		Assert.Null(element);
	}

	[Fact]
	public void AngularDimensionBuilder_packs_inputs_into_DimensionElement()
	{
		var style = new DimensionStyle { TextSize = 2.5 };
		var element = AngularDimensionBuilder.Build(0, 0, 50, 0, 0, 50, null, style);

		Assert.NotNull(element);
		Assert.Equal(DimensionKind.Angular, element!.Kind);
		Assert.Equal(new Point2D(0, 0), element.Vertex);
		Assert.Equal(new Point2D(50, 0), element.A);
		Assert.Equal(new Point2D(0, 50), element.B);
	}

	[Fact]
	public void AngularDimensionBuilder_rejects_collinear_arms()
	{
		// vertex(0,0) -> A(10,0) and vertex(0,0) -> B(20,0) point the same direction.
		var element = AngularDimensionBuilder.Build(0, 0, 10, 0, 20, 0, null, new DimensionStyle());
		Assert.Null(element);
	}

	[Fact]
	public void AngularDimensionBuilder_rejects_degenerate_arm()
	{
		// Arm A length zero.
		var element = AngularDimensionBuilder.Build(0, 0, 0, 0, 10, 10, null, new DimensionStyle());
		Assert.Null(element);
	}
}
