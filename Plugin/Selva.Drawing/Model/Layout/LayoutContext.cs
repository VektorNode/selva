using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Rectangle a LayoutElement is asked to fit into during Resolve (Y-up world coords, mm).
// A Stack with Stretch alignment fills the cross axis; a Grid with star-sized columns
// divides the available width; both read this to decide flexible sizes.
//
// Available is empty when the layout pass runs before page bounds are known (e.g. during
// auto-fit); primitives should fall back to their natural size in that case.
public readonly struct LayoutContext
{
	public BoundingBox Available { get; }

	public LayoutContext(BoundingBox available)
	{
		Available = available;
	}

	// Available may constrain only one axis: a vertical Stack hands children its cross
	// width but leaves the main axis unbounded, so finiteness is checked per axis.
	public bool HasFiniteAvailableWidth => !Available.IsEmpty && !double.IsPositiveInfinity(Available.Width);
	public bool HasFiniteAvailableHeight => !Available.IsEmpty && !double.IsPositiveInfinity(Available.Height);

	public double AvailableWidth => Available.IsEmpty ? double.PositiveInfinity : Available.Width;
	public double AvailableHeight => Available.IsEmpty ? double.PositiveInfinity : Available.Height;
}
