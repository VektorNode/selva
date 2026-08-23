using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Phase: pagination. The result of asking a layout element to fit into a given vertical
// budget. Three outcomes:
//   - Fits != null, Overflow == null   → everything fit on the current page.
//   - Fits != null, Overflow != null   → partial fit; render Fits now, ask Overflow for the next page.
//   - Fits == null, Overflow != null   → nothing fit on this page (caller decides whether to skip
//                                          to a fresh page or force-place to guarantee progress).
public readonly struct SplitResult
{
    public DrawElement Fits { get; }
    public DrawElement Overflow { get; }
    public double FitsHeight { get; }

    public SplitResult(DrawElement fits, DrawElement overflow, double fitsHeight)
    {
        Fits = fits;
        Overflow = overflow;
        FitsHeight = fitsHeight;
    }

    public static SplitResult AllFits(DrawElement element, double height)
        => new SplitResult(element, null, height);

    public static SplitResult NothingFits(DrawElement element)
        => new SplitResult(null, element, 0);

    public static SplitResult Partial(DrawElement fits, DrawElement overflow, double fitsHeight)
        => new SplitResult(fits, overflow, fitsHeight);
}
