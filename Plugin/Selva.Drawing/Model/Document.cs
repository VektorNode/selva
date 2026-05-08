using System;
using System.Collections.Generic;

namespace Selva.Drawing.Model;

// PDF /Info dictionary equivalent. Author/Title/Subject/Keywords map directly to PDF
// metadata fields; SVG renderer surfaces Title in <title> and the rest as <metadata> RDF.
public sealed class DocumentMetadata
{
	public string Title { get; init; }
	public string Author { get; init; }
	public string Subject { get; init; }
	public string Creator { get; init; }
	public string Producer { get; init; }
	public IReadOnlyList<string> Keywords { get; init; }
	public DateTime? CreatedAt { get; init; }
	public DateTime? ModifiedAt { get; init; }
}

public sealed class Document
{
	public DocumentMetadata Metadata { get; init; } = new DocumentMetadata();
	public IReadOnlyList<Page> Pages { get; init; } = Array.Empty<Page>();
}
