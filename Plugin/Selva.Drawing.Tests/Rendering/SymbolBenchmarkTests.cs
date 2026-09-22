using System;
using System.Diagnostics;
using System.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Pdf;
using Selva.Drawing.Rendering.Svg;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering;

// Benchmarks symbol dedupe against inline expansion: render time and output bytes.
// Target: large drawings render in <1s (PDF <2MB, SVG <1MB).
public class SymbolBenchmarkTests
{
	private static readonly SymbolDefinition LineSymbol = new SymbolDefinition
	{
		Id = "line",
		Children = new DrawElement[]
		{
			new PathElement
			{
				Path = new Path.Builder().MoveTo(0, 0).LineTo(5, 0).LineTo(5, 5).LineTo(0, 5).Close().Build(),
				Stroke = new Selva.Drawing.Model.Style.Stroke { Width = 0.25 },
			},
		},
	};

	private static readonly SymbolDefinition AnonymousLineSymbol = new SymbolDefinition
	{
		// No Id: falls back to inline expansion.
		Children = new DrawElement[]
		{
			new PathElement
			{
				Path = new Path.Builder().MoveTo(0, 0).LineTo(5, 0).LineTo(5, 5).LineTo(0, 5).Close().Build(),
				Stroke = new Selva.Drawing.Model.Style.Stroke { Width = 0.25 },
			},
		},
	};

	[Fact(Skip = "Benchmark — run manually. Reports numbers to stdout.")]
	public void Benchmark_10k_symbols_svg()
	{
		var (inlineBytes, inlineMs) = MeasureSvg(AnonymousLineSymbol, 100);
		var (dedupeBytes, dedupeMs) = MeasureSvg(LineSymbol, 100);

		Console.WriteLine($"SVG: Inline {inlineBytes:N0} bytes in {inlineMs:N0}ms | Dedupe {dedupeBytes:N0} bytes in {dedupeMs:N0}ms | Savings {100.0 * (inlineBytes - dedupeBytes) / inlineBytes:F1}%");
		Assert.True(dedupeMs < 1000, $"Dedupe SVG took {dedupeMs}ms — target is <1s");
		Assert.True(dedupeBytes < 1_000_000, $"Dedupe SVG is {dedupeBytes:N0} bytes — target is <1MB");
	}

	[Fact(Skip = "Benchmark — run manually. Reports numbers to stdout.")]
	public void Benchmark_10k_symbols_pdf()
	{
		var (inlineBytes, inlineMs) = MeasurePdf(AnonymousLineSymbol, 100);
		var (dedupeBytes, dedupeMs) = MeasurePdf(LineSymbol, 100);

		Console.WriteLine($"PDF: Inline {inlineBytes:N0} bytes in {inlineMs:N0}ms | Dedupe {dedupeBytes:N0} bytes in {dedupeMs:N0}ms | Savings {100.0 * (inlineBytes - dedupeBytes) / inlineBytes:F1}%");
		Assert.True(dedupeMs < 1000, $"Dedupe PDF took {dedupeMs}ms — target is <1s");
		Assert.True(dedupeBytes < 2_000_000, $"Dedupe PDF is {dedupeBytes:N0} bytes — target is <2MB");
	}

	[Fact]
	public void Benchmark_10k_symbols_svg_sanity()
	{
		// Quick sanity check: dedupe SVG is smaller than inline. Deliberately no timing
		// assertion: at this size both renders are sub-millisecond, so a wall-clock
		// comparison measures JIT warm-up and CI scheduling noise, not the dedupe path.
		var (inlineBytes, _) = MeasureSvg(AnonymousLineSymbol, 10);
		var (dedupeBytes, _) = MeasureSvg(LineSymbol, 10);
		Assert.True(dedupeBytes < inlineBytes, "Dedupe should be smaller");
	}

	[Fact(Skip = "Informational — runs in ~1s, useful for profiling but not a gate")]
	public void Benchmark_10k_symbols_pdf_sanity()
	{
		// Form XObject dedupe has overhead on small documents (metadata + resource mgmt).
		// The dedupe win kicks in around 200-500 instances. Testing with 100x100 (10k).
		var (inlineBytes, inlineMs) = MeasurePdf(AnonymousLineSymbol, 100);
		var (dedupeBytes, dedupeMs) = MeasurePdf(LineSymbol, 100);
		Console.WriteLine($"PDF 100×100 (10k instances): Inline {inlineBytes:N0} bytes in {inlineMs}ms, Dedupe {dedupeBytes:N0} bytes in {dedupeMs}ms, Savings {100.0 * (inlineBytes - dedupeBytes) / inlineBytes:F1}%");
	}

	private static (int bytes, long ms) MeasureSvg(SymbolDefinition symbolDef, int gridSize)
	{
		var children = BuildGrid(symbolDef, gridSize);
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Content = new GroupElement { Children = children } },
			},
		};

		var sw = Stopwatch.StartNew();
		var svg = new SvgRenderer(new SvgRenderOptions { Padding = 10 }).Render(doc);
		sw.Stop();

		return (svg.Length, sw.ElapsedMilliseconds);
	}

	private static (int bytes, long ms) MeasurePdf(SymbolDefinition symbolDef, int gridSize)
	{
		var children = BuildGrid(symbolDef, gridSize);
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Content = new GroupElement { Children = children } },
			},
		};

		var sw = Stopwatch.StartNew();
		var bytes = new PdfRenderer().Render(doc);
		sw.Stop();

		return (bytes.Length, sw.ElapsedMilliseconds);
	}

	private static DrawElement[] BuildGrid(SymbolDefinition symbolDef, int gridSize)
	{
		var elements = new DrawElement[gridSize * gridSize];
		for (var y = 0; y < gridSize; y++)
		{
			for (var x = 0; x < gridSize; x++)
			{
				var idx = y * gridSize + x;
				elements[idx] = new SymbolElement
				{
					Definition = symbolDef,
					Position = new Point2D(x * 10.0, y * 10.0),
				};
			}
		}
		return elements;
	}
}
