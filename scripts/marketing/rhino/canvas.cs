// Writes the active Grasshopper canvas as images: the whole definition, and one per titled group.
// Run in Rhino:  _-ScriptEditor _Run "<repo>\scripts\marketing\rhino\canvas.cs"
// Output: <repo>\marketing\grasshopper\<definition>\.

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Grasshopper;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel.Special;

var canvas = Instances.ActiveCanvas;
var doc = canvas.Document;
var name = Path.GetFileNameWithoutExtension(doc.FilePath);
var repo = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(doc.FilePath), "..", ".."));
var folder = Path.Combine(repo, "marketing", "grasshopper", name);
Directory.CreateDirectory(folder);

var background = Color.FromArgb(255, 212, 208, 200);
// GDI+ refuses a bitmap much past this on a side.
const float MaxSide = 12000f;

void Shoot(RectangleF region, float zoom, int margin, string file)
{
	zoom = Math.Min(zoom, Math.Min(MaxSide / region.Width, MaxSide / region.Height));
	var viewport = new GH_Viewport
	{
		Width = (int)(region.Width * zoom) + margin * 2,
		Height = (int)(region.Height * zoom) + margin * 2,
		Zoom = zoom,
		MidPoint = new PointF(region.X + region.Width / 2, region.Y + region.Height / 2)
	};
	using var bitmap = canvas.GenerateHiResImageTile(viewport, background);
	bitmap.Save(Path.Combine(folder, file), ImageFormat.Png);
	Console.WriteLine($"{file} {bitmap.Width}x{bitmap.Height}");
}

Shoot(doc.BoundingBox(false), 2f, 80, "canvas.png");

// "Inputs" and "Outputs" only mark the ends of a titled group.
var titled = doc.Objects.OfType<GH_Group>()
	.Where(g => !string.IsNullOrWhiteSpace(g.NickName) && g.NickName != "Inputs" && g.NickName != "Outputs");
foreach (var group in titled)
{
	var slug = Regex.Replace(group.NickName.ToLowerInvariant(), @"\W+", "-").Trim('-');
	Shoot(group.Attributes.Bounds, 3f, 60, $"group-{slug}.png");
}
