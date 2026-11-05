#nullable enable
using System.Threading;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     One modal prompt at a time on Rhino's UI thread, across every bridge: a file dialog or a
///     viewport pick. Rhino runs queued UI-thread work inside each one's loop, so a second prompt
///     would open nested inside the first.
/// </summary>
internal sealed class ModalGate
{
    public static readonly ModalGate Shared = new ModalGate();

    private int _open;

    public bool TryEnter()
    {
        return Interlocked.CompareExchange(ref _open, 1, 0) == 0;
    }

    public void Exit()
    {
        Interlocked.Exchange(ref _open, 0);
    }
}
