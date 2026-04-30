namespace Selva.Drawing;

public struct SvgBounds
{
    public static readonly SvgBounds Empty = new SvgBounds(double.MaxValue, double.MaxValue, double.MinValue, double.MinValue);

    public double MinX { get; set; }
    public double MinY { get; set; }
    public double MaxX { get; set; }
    public double MaxY { get; set; }

    public SvgBounds(double minX, double minY, double maxX, double maxY)
    {
        MinX = minX;
        MinY = minY;
        MaxX = maxX;
        MaxY = maxY;
    }

    public bool IsValid => MinX <= MaxX && MinY <= MaxY;

    public double Width => MaxX - MinX;
    public double Height => MaxY - MinY;

    public void Union(SvgBounds other)
    {
        if (!other.IsValid) return;
        if (other.MinX < MinX) MinX = other.MinX;
        if (other.MinY < MinY) MinY = other.MinY;
        if (other.MaxX > MaxX) MaxX = other.MaxX;
        if (other.MaxY > MaxY) MaxY = other.MaxY;
    }

    public void Union(double x, double y)
    {
        if (x < MinX) MinX = x;
        if (y < MinY) MinY = y;
        if (x > MaxX) MaxX = x;
        if (y > MaxY) MaxY = y;
    }
}
