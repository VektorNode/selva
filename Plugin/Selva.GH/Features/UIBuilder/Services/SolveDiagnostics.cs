using System.Collections.Generic;
using Newtonsoft.Json;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     One runtime message raised by a component during the solve.
/// </summary>
/// <remarks>
///     Every property carries an explicit <c>[JsonProperty]</c>: the transport's serializer has no
///     camelCase resolver, so a typed class otherwise goes out PascalCase and the web's validator
///     drops the fields without failing anything (the same trap <c>SyncChange</c> fell into).
/// </remarks>
public class SolveDiagnostic
{
    /// <summary>"remark", "warning", or "error" — the wire vocabulary, matching the levels the
    /// web UI's toast handler already understands.</summary>
    [JsonProperty("level")]
    public string Level { get; set; }

    [JsonProperty("message")] public string Message { get; set; }

    /// <summary>Nickname of the component that raised it, so the UI can say where.</summary>
    [JsonProperty("source")]
    public string Source { get; set; }

    /// <summary>True when a Selva Message component raised this. Only these gate the outputs —
    /// see <see cref="SolveDiagnostics.Blocked" />.</summary>
    [JsonProperty("isGate")]
    public bool IsGate { get; set; }
}

/// <summary>Everything the solve reported, and whether its outputs may be trusted.</summary>
public class SolveDiagnostics
{
    /// <summary>
    ///     Marker the Message component prepends to a blocking error, and the collector strips
    ///     before the text reaches the UI.
    ///
    ///     Rhino.Compute flattens runtime messages to bare strings with no component attribution,
    ///     so on that path this is the only way to tell a deliberate block from any other error.
    ///     Must stay identical to <c>SOLVE_BLOCKED_MARKER</c> in
    ///     <c>packages/solve/src/shared/solve-fn.ts</c>. It is baked into published definitions'
    ///     solve output, so changing it breaks blocking for every .gh already in the wild.
    /// </summary>
    public const string BlockedMarker = "[Selva:blocked]";

    public List<SolveDiagnostic> Messages { get; } = new List<SolveDiagnostic>();

    /// <summary>True when a Message component raised an error. The bridge then sends the
    /// diagnostics with no outputs, rather than geometry the author has declared invalid.</summary>
    public bool Blocked { get; set; }

    public bool HasAny => Messages.Count > 0;
}
