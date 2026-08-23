using System.IO;

namespace Selva.Drawing.Tests.Rendering;

// Compares renderer output against the pinned snapshot files; re-pin with
// SnapshotGenerator when a renderer change is intentional.
public class SvgRendererSnapshotTests
{
	private static readonly string SnapshotDir = Path.Combine(
		Path.GetDirectoryName(typeof(SvgRendererSnapshotTests).Assembly.Location)!,
		"Rendering", "Snapshots");

	[Theory]
	[InlineData("single_path_curve.svg")]
	[InlineData("filled_surface.svg")]
	[InlineData("surface_with_holes.svg")]
	[InlineData("single_text.svg")]
	[InlineData("linear_dimension.svg")]
	[InlineData("angular_dimension.svg")]
	[InlineData("combined_path_text_dimension.svg")]
	[InlineData("empty_document.svg")]
	[InlineData("linear_dimension_breakline.svg")]
	[InlineData("symbol_dedupe.svg")]
	public void Renderer_output_matches_pinned_snapshot(string snapshotName)
	{
		var expected = File.ReadAllText(Path.Combine(SnapshotDir, snapshotName));
		var actual = snapshotName switch
		{
			"single_path_curve.svg" => SvgScenes.SinglePathCurve(),
			"filled_surface.svg" => SvgScenes.FilledSurface(),
			"surface_with_holes.svg" => SvgScenes.SurfaceWithHoles(),
			"single_text.svg" => SvgScenes.SingleText(),
			"linear_dimension.svg" => SvgScenes.LinearDimension(),
			"angular_dimension.svg" => SvgScenes.AngularDimension(),
			"combined_path_text_dimension.svg" => SvgScenes.CombinedPathTextDimension(),
			"empty_document.svg" => SvgScenes.EmptyDocument(),
			"linear_dimension_breakline.svg" => SvgScenes.LinearDimensionBreakLine(),
			"symbol_dedupe.svg" => SvgScenes.SymbolDedupe(),
			_ => throw new System.ArgumentException($"Unknown snapshot {snapshotName}"),
		};

		Assert.Equal(expected, actual);
	}
}
