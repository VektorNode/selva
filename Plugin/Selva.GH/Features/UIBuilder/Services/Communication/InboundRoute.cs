namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>What the transport does with an inbound frame, decided by <see cref="BridgeAccess" />.</summary>
public enum InboundRoute
{
    Dispatch,

    /// <summary>The session's role may not send it.</summary>
    RefusedForRole,

    /// <summary>Only the Rhino panel may send it, and a browser tab did.</summary>
    RefusedFromBrowserTab,

    /// <summary>A binary frame whose header isn't a file to save.</summary>
    NotAHostFile
}
