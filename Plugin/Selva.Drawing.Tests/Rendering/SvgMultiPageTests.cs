using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Svg;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering;

// SVG has no native multi-page concept, so RenderAll returns one SVG string per page.
public class SvgMultiPageTests
{
	[Fact]
	public void RenderAll_returns_one_svg_per_page()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				MakePage("Page 1"),
				MakePage("Page 2"),
				MakePage("Page 3"),
			},
		};

		var svgs = new SvgRenderer().RenderAll(doc);

		Assert.Equal(3, svgs.Count);
		foreach (var svg in svgs) Assert.StartsWith("<?xml", svg);
	}

	[Fact]
	public void RenderAll_emits_per_page_titles()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				MakePage("Cover"),
				MakePage("Plan"),
			},
		};

		var svgs = new SvgRenderer().RenderAll(doc);

		Assert.Contains("<title>Cover</title>", svgs[0]);
		Assert.Contains("<title>Plan</title>", svgs[1]);
	}

	[Fact]
	public void RenderAll_on_empty_document_returns_one_blank_svg()
	{
		var svgs = new SvgRenderer().RenderAll(new Document());
		Assert.Single(svgs);
		Assert.Contains("<svg", svgs[0]);
	}

	private static Page MakePage(string title)
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(20, 0).LineTo(20, 10).Close().Build();
		return new Page
		{
			Title = title,
			Content = new PathElement { Path = path },
		};
	}
}
