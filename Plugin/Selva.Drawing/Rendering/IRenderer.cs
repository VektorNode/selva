using Selva.Drawing.Model;

namespace Selva.Drawing.Rendering;

// Renderers are pure functions Document -> output. Concrete implementations live one
// folder deeper (Rendering/Svg, Rendering/Pdf). Output type varies — SVG is text, PDF is
// bytes — so each renderer exposes its own typed Render method rather than forcing a
// lossy `byte[] Render()` here.
public interface IRenderer<out TOutput>
{
	TOutput Render(Document document);
}
