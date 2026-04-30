using System;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Elements;

public enum ImageFormat { Png, Jpeg, Webp, Svg }

// Embedded raster (or vector via Svg) image. Data is the raw bytes of the encoded image —
// renderers decide how to embed (data: URI for SVG, image XObject for PDF). Position/Size
// are in document units.
public sealed class ImageElement : DrawElement
{
	public byte[] Data { get; init; }
	public ImageFormat Format { get; init; }
	public Point2D Position { get; init; }
	public double Width { get; init; }
	public double Height { get; init; }

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds() =>
		new BoundingBox(Position.X, Position.Y, Position.X + Width, Position.Y + Height);
}
