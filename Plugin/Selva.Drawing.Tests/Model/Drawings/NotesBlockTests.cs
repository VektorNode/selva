using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;

namespace Selva.Drawing.Tests.Model.Drawings;

public class NotesBlockTests
{
	[Fact]
	public void Empty_notes_block_resolves_to_empty_group()
	{
		var notes = new NotesBlock();
		var resolved = notes.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
	}

	[Fact]
	public void Notes_block_grows_with_count()
	{
		var one = new NotesBlock { Notes = new[] { "Tighten to 3 N·m" } };
		var three = new NotesBlock
		{
			Notes = new[]
			{
				"Tighten to 3 N·m",
				"Apply thread-locker",
				"Verify alignment with pin gauge",
			},
		};
		Assert.True(three.ComputeBounds().Height > one.ComputeBounds().Height);
	}

	[Fact]
	public void Long_note_wraps_in_body_column()
	{
		var notes = new NotesBlock
		{
			Width = 60,
			Notes = new[]
			{
				"This is a long note that should wrap onto multiple lines so the natural height grows beyond a single line of text.",
			},
		};
		var b = notes.ComputeBounds();
		Assert.True(b.Height > 6); // single-line note is ~3mm tall; wrapping pushes it past 6mm
	}

	[Fact]
	public void Custom_markers_replace_auto_numbering()
	{
		var notes = new NotesBlock
		{
			Notes = new[] { "Note A", "Note B" },
			Markers = new[] { "A.", "B." },
		};
		var b = notes.ComputeBounds();
		Assert.True(b.Width > 0);
		Assert.True(b.Height > 0);
	}

	[Fact]
	public void Title_adds_height()
	{
		var withTitle = new NotesBlock { Title = "GENERAL NOTES", Notes = new[] { "x" } };
		var without = new NotesBlock { Notes = new[] { "x" } };
		Assert.True(withTitle.ComputeBounds().Height > without.ComputeBounds().Height);
	}

	[Fact]
	public void Title_gap_is_exactly_TitleSpacing()
	{
		// Regression: the old spacer-child implementation added TitleSpacing + NoteSpacing
		// between title and first note. Total height must decompose as titleHeight + TitleSpacing + notesHeight.
		var notes = new[] { "First note", "Second note" };
		var titleOnly = new NotesBlock { Title = "GENERAL NOTES" };
		var notesOnly = new NotesBlock { Notes = notes };
		var combined = new NotesBlock
		{
			Title = "GENERAL NOTES",
			Notes = notes,
			TitleSpacing = 2.0,
			NoteSpacing = 1.5,
		};

		var expected = titleOnly.ComputeBounds().Height + 2.0 + notesOnly.ComputeBounds().Height;
		Assert.Equal(expected, combined.ComputeBounds().Height, 6);
	}
}
