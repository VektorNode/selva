using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Phase 7: passed into LayoutElement.Resolve during the layout pass. Carries the rectangle
// the element is being asked to fit into (Y-up world coords, mm). Layout primitives use
// this to decide flexible sizes — e.g. a Stack with Stretch alignment fills the cross axis,
// a Grid with star-sized columns divides the available width.
//
// Available may be empty when the layout pass runs before the page bounds are known
// (e.g. during auto-fit). In that case primitives should fall back to their natural size
// (typically: as small as possible while honouring child requests).
public readonly struct LayoutContext
{
	public BoundingBox Available { get; }

	public LayoutContext(BoundingBox available)
	{
		Available = available;
	}

	// The available box may constrain only one axis (e.g. a vertical Stack hands children
	// its cross width but an unbounded main axis), so finiteness is per-axis.
	public bool HasFiniteAvailableWidth => !Available.IsEmpty && !double.IsPositiveInfinity(Available.Width);
	public bool HasFiniteAvailableHeight => !Available.IsEmpty && !double.IsPositiveInfinity(Available.Height);

	public double AvailableWidth => Available.IsEmpty ? double.PositiveInfinity : Available.Width;
	public double AvailableHeight => Available.IsEmpty ? double.PositiveInfinity : Available.Height;
}
