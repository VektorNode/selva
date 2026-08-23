using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;

namespace Selva.Drawing.Tests.Model.Drawings;

public class RevisionTableTests
{
	[Fact]
	public void Empty_revision_table_renders_just_a_header_row()
	{
		var table = new RevisionTable();
		var resolved = table.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
		var b = resolved.ComputeBounds();
		Assert.True(b.Width > 0);
		Assert.True(b.Height > 0);
	}

	[Fact]
	public void Revision_table_total_width_matches_configured_width()
	{
		var table = new RevisionTable
		{
			Width = 120,
			Entries = new[]
			{
				new RevisionEntry { Revision = "A", Date = "2026-04-01", Description = "Initial issue", By = "FB" },
				new RevisionEntry { Revision = "B", Date = "2026-04-15", Description = "Fixed plate hole positions", By = "FB" },
			},
		};
		var b = table.ComputeBounds();
		Assert.Equal(120, b.Width, 6);
	}

	[Fact]
	public void Revision_table_grows_with_entries()
	{
		var oneEntry = new RevisionTable
		{
			Entries = new[] { new RevisionEntry { Revision = "A", Date = "01/01", Description = "x", By = "F" } },
		};
		var threeEntries = new RevisionTable
		{
			Entries = new[]
			{
				new RevisionEntry { Revision = "A", Date = "01/01", Description = "x", By = "F" },
				new RevisionEntry { Revision = "B", Date = "02/01", Description = "y", By = "F" },
				new RevisionEntry { Revision = "C", Date = "03/01", Description = "z", By = "F" },
			},
		};
		Assert.True(threeEntries.ComputeBounds().Height > oneEntry.ComputeBounds().Height);
	}
}
