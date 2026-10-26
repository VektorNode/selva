using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Rendering.Svg;
using Xunit.Abstractions;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class LayoutCacheTests
{
	private readonly ITestOutputHelper _output;

	public LayoutCacheTests(ITestOutputHelper output) => _output = output;

	private sealed class Counted : LayoutElement
	{
		public int Calls;

		protected override DrawElement ResolveCore(LayoutContext context)
		{
			Calls++;
			var width = context.HasFiniteAvailableWidth ? context.AvailableWidth : 40;
			return new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(width, 0).LineTo(width, 5).Build() };
		}
	}

	// Grid in Stack in Grid ...: the shape of a drawing page (title strip, heading, body).
	private static DrawElement Nest(DrawElement inner, int depth)
	{
		for (var i = 0; i < depth; i++)
		{
			inner = i % 2 == 0
				? new Grid
				{
					Columns = new[] { GridLength.Star(1), GridLength.Absolute(10) },
					Rows = new[] { GridLength.Auto },
					Cells = new[] { new GridCell { Row = 0, Column = 0, Content = inner } },
				}
				: new Stack
				{
					Orientation = StackOrientation.Vertical,
					CrossAlign = CrossAlign.Stretch,
					Children = new[] { inner },
				};
		}

		return inner;
	}

	private static readonly LayoutContext Page = new(new BoundingBox(0, 0, 190, 270));

	[Fact]
	public void A_layout_pass_resolves_nested_content_once_per_context_it_is_offered()
	{
		var uncached = new Counted();
		((LayoutElement)Nest(uncached, 6)).Resolve(Page);

		var cached = new Counted();
		LayoutPass.Resolve(Nest(cached, 6), Page);

		// Each Grid measures its cells, then resolves them at their real size: three Grids, 2^3.
		_output.WriteLine($"innermost resolved {uncached.Calls} times outside a pass, {cached.Calls} inside");
		Assert.Equal(8, uncached.Calls);
		Assert.True(cached.Calls <= 2, $"the pass resolved the innermost element {cached.Calls} times");
	}

	[Fact]
	public void A_layout_pass_draws_the_same_as_resolving_without_it()
	{
		var content = Nest(new Stack
		{
			Orientation = StackOrientation.Vertical,
			CrossAlign = CrossAlign.Stretch,
			Children = new DrawElement[]
			{
				new TextFlow { Text = "a heading long enough to wrap inside a narrow star column of the grid" },
				Nest(new Counted(), 3),
			},
		}, 5);

		var direct = ((LayoutElement)content).Resolve(Page);
		var pass = LayoutPass.Resolve(content, Page);

		Assert.Equal(Svg(direct), Svg(pass));
	}

	[Fact]
	public void Outside_a_pass_every_resolve_runs()
	{
		var element = new Counted();
		element.Resolve(Page);
		element.Resolve(Page);
		Assert.Equal(2, element.Calls);
	}

	private static string Svg(DrawElement content)
	{
		var page = new Page { Size = PaperSize.A4, Margins = Margins.Uniform(10), Content = content };
		var document = new Document { Pages = new[] { page } };
		return new SvgRenderer().RenderPage(document, page);
	}
}
