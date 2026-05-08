using System.IO;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.Advanced;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Pdf;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Phase 10a: SymbolDefinitions with an Id are emitted as a single Form XObject and
// instanced via DrawImage. Anonymous symbols continue to inline-expand. The dedupe
// pass cuts the number of Form XObject resources from N (one per instance) to 1
// (one per unique definition), which is the headline benefit: large drawings with
// many repeated symbols stay small.
public class PdfSymbolDedupeTests
{
	private static SymbolDefinition Triangle() => new SymbolDefinition
	{
		Id = "tri",
		Children = new DrawElement[]
		{
			new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(5, 0).LineTo(2.5, 4).Close().Build() },
		},
	};

	private static byte[] Render(DrawElement[] children)
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Content = new GroupElement { Children = children } },
			},
		};
		return new PdfRenderer().Render(doc);
	}

	[Fact]
	public void Three_instances_of_same_definition_share_one_form_xobject()
	{
		var def = Triangle();
		var bytes = Render(new DrawElement[]
		{
			new SymbolElement { Definition = def, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = def, Position = new Point2D(20, 0) },
			new SymbolElement { Definition = def, Position = new Point2D(40, 0) },
		});

		using var ms = new MemoryStream(bytes);
		using var pdf = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);

		var formCount = CountFormXObjects(pdf);
		Assert.Equal(1, formCount);
	}

	[Fact]
	public void Two_distinct_definitions_emit_two_form_xobjects()
	{
		var triA = new SymbolDefinition
		{
			Id = "a",
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(5, 0).Close().Build() } },
		};
		var triB = new SymbolDefinition
		{
			Id = "b",
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(7, 0).Close().Build() } },
		};
		var bytes = Render(new DrawElement[]
		{
			new SymbolElement { Definition = triA, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = triA, Position = new Point2D(10, 0) },
			new SymbolElement { Definition = triB, Position = new Point2D(20, 0) },
			new SymbolElement { Definition = triB, Position = new Point2D(30, 0) },
		});

		using var ms = new MemoryStream(bytes);
		using var pdf = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);

		Assert.Equal(2, CountFormXObjects(pdf));
	}

	[Fact]
	public void Anonymous_definition_does_not_create_a_form_xobject()
	{
		var anon = new SymbolDefinition
		{
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(2, 0).Close().Build() } },
		};
		var bytes = Render(new DrawElement[]
		{
			new SymbolElement { Definition = anon, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = anon, Position = new Point2D(10, 0) },
		});

		using var ms = new MemoryStream(bytes);
		using var pdf = PdfReader.Open(ms, PdfDocumentOpenMode.Modify);

		Assert.Equal(0, CountFormXObjects(pdf));
	}

	[Fact]
	public void Same_id_with_conflicting_definitions_throws()
	{
		var defA = new SymbolDefinition
		{
			Id = "shared",
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(1, 0).Build() } },
		};
		var defB = new SymbolDefinition
		{
			Id = "shared",
			Children = new DrawElement[] { new PathElement { Path = new Path.Builder().MoveTo(0, 0).LineTo(2, 0).Build() } },
		};
		Assert.Throws<System.InvalidOperationException>(() => Render(new[]
		{
			new SymbolElement { Definition = defA, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = defB, Position = new Point2D(10, 0) },
		}));
	}

	[Fact]
	public void Pdf_with_dedup_round_trips_through_pdfreader()
	{
		var def = Triangle();
		var bytes = Render(new DrawElement[]
		{
			new SymbolElement { Definition = def, Position = new Point2D(0, 0) },
			new SymbolElement { Definition = def, Position = new Point2D(20, 0) },
		});
		Assert.Equal((byte)'%', bytes[0]);
		Assert.Equal((byte)'P', bytes[1]);

		using var ms = new MemoryStream(bytes);
		using var pdf = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, pdf.PageCount);
	}

	// Walks every page's resource dictionary and counts Form XObjects. Form XObjects are
	// PDF objects with /Type /XObject and /Subtype /Form; PdfSharpCore stores them under
	// each page's /Resources/XObject dict.
	private static int CountFormXObjects(PdfDocument pdf)
	{
		var count = 0;
		foreach (PdfPage page in pdf.Pages)
		{
			var resources = page.Resources;
			if (resources == null) continue;
			var xObjects = resources.Elements.GetDictionary("/XObject");
			if (xObjects == null) continue;

			foreach (var key in xObjects.Elements.Keys)
			{
				var item = xObjects.Elements[key];
				PdfDictionary? dict = null;
				if (item is PdfReference reference) dict = reference.Value as PdfDictionary;
				else if (item is PdfDictionary direct) dict = direct;

				if (dict == null) continue;
				var subtype = dict.Elements.GetName("/Subtype");
				if (subtype == "/Form") count++;
			}
		}
		return count;
	}
}
