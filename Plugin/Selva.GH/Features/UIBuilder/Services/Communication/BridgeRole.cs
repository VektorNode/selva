namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     What a session may do. An author session started from the canvas and may edit the schema.
///     A player session started from the Selva panel: it sets values, and nothing it sends may
///     write the schema back.
/// </summary>
public enum BridgeRole
{
    Author,
    Player
}
