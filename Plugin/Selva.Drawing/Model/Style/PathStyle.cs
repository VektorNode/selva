namespace Selva.Drawing.Model.Style;

// Bundle of (Stroke, Fill) for a single path element. Useful as a parameter type for
// authoring tools (e.g. the Grasshopper Path Style component) that produce a reusable
// style object then feed it into multiple paths. Either component may be null: null
// stroke means no outline, null fill means no fill.
public sealed class PathStyle
{
	public Stroke Stroke { get; init; }
	public Fill Fill { get; init; }
}
