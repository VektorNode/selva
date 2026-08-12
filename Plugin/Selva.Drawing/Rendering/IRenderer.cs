using Selva.Drawing.Model;

namespace Selva.Drawing.Rendering;

// Renderers are pure functions Document -> output. Output type varies — SVG is text, PDF
// is bytes — so TOutput avoids forcing a lossy `byte[] Render()` on every implementation.
public interface IRenderer<out TOutput>
{
	TOutput Render(Document document);
}
