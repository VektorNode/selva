using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Rhino;
using Selva.Schema.Models;
using Selva.GH.Config;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Payload from a UI save request: the draft schema plus the hash of the
///     canonical it was forked from. The orchestrator rejects the save if the
///     base hash no longer matches the current canonical.
/// </summary>
public class SchemaSaveRequest
{
    public UISchema Schema { get; set; }
    public string BaseSchemaHash { get; set; }
}

/// <summary>
///     Handles WebSocket communication with the web UI.
/// </summary>
public class WebSocketTransport : IDisposable
{
    /// <summary>
    ///     Secure JSON serializer — prevents type confusion attacks, created once and reused.
    /// </summary>
    private static readonly JsonSerializerSettings SecureSerializerSettings = new JsonSerializerSettings
    {
        TypeNameHandling = TypeNameHandling.None,
        MaxDepth = AppConfig.JsonSerialization.MaxJsonDepth,
        MetadataPropertyHandling = MetadataPropertyHandling.Ignore
    };

    private static readonly JsonSerializer SecureSerializer =
        JsonSerializer.Create(SecureSerializerSettings);

    private readonly int _port;
    private readonly string _sessionId;

    // Pure parse/classify of inbound frames — unit-tested in InboundMessageParserTests. This
    // transport keeps only the socket, the thread marshalling, and the event raising.
    private readonly InboundMessageParser _inboundParser = new InboundMessageParser(SecureSerializer);

    // All mutable state that can be touched from multiple threads is guarded by _stateLock.
    private readonly object _stateLock = new object();
    private bool _disposed;

    // Interlocked is sufficient for a single int flag.
    private int _initialDataInFlight;
    private bool? _lastBroadcastedSolvingState;
    private int _suppressSolvingCyclesRemaining;

    private WebSocketServer _webSocketServer;

    public WebSocketTransport(string sessionId, int port = 8765)
    {
        _sessionId = sessionId;
        _port = port;
    }

    public bool IsRunning => _webSocketServer?.IsRunning ?? false;
    public int WebSocketPort => _webSocketServer?.Port ?? _port;

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    public event EventHandler<Dictionary<string, object>> OnValuesReceived;
    public event EventHandler OnCurrentValuesRequested;
    public event EventHandler OnClientConnected;
    public event EventHandler<SchemaSaveRequest> OnSchemaSaveRequested;
    public event EventHandler<UISchema> OnSyncPreviewRequested;
    public event EventHandler<List<SyncChange>> OnSyncChangesApply;

    protected virtual void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (disposing)
        {
            Stop();
        }

        _disposed = true;
    }

    /// <summary>
    ///     Start the WebSocket server.
    /// </summary>
    public async Task StartAsync(Action<string> logMessage)
    {
        if (_webSocketServer?.IsRunning == true)
        {
            return;
        }

        try
        {
            _webSocketServer = new WebSocketServer(_port);
            _webSocketServer.OnClientConnected += HandleClientConnected;
            _webSocketServer.OnMessageReceived += HandleMessageReceived;

            var startTask = _webSocketServer.StartAsync();
            if (await Task.WhenAny(startTask, Task.Delay(AppConfig.WebSocket.ServerStartupTimeoutMs))
                != startTask)
            {
                throw new TimeoutException(
                    $"WebSocket server startup timed out after {AppConfig.WebSocket.ServerStartupTimeoutMs}ms");
            }

            await startTask; // propagate any startup exceptions
        }
        catch (Exception ex)
        {
            logMessage?.Invoke(ex is TimeoutException
                ? ex.Message
                : $"Could not start WebSocket server: {ex.Message}");
            throw;
        }
    }

    /// <summary>
    ///     Stop the WebSocket server and reset all session state.
    /// </summary>
    public void Stop()
    {
        if (_webSocketServer == null)
        {
            return;
        }

        try
        {
            // Dispose calls Stop internally — no need to call both.
            _webSocketServer.Dispose();
        }
        catch (Exception ex)
        {
            Logger.Warn($"Error stopping WebSocket: {ex.Message}");
        }
        finally
        {
            _webSocketServer = null;

            lock (_stateLock)
            {
                _lastBroadcastedSolvingState = null;
                _suppressSolvingCyclesRemaining = 0;
            }

            Interlocked.Exchange(ref _initialDataInFlight, 0);
        }
    }

    // -------------------------------------------------------------------------
    // Suppression
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Suppress the next N solution cycles (used during schema saves).
    /// </summary>
    public void SuppressSolvingCycles(int cycles)
    {
        lock (_stateLock)
        {
            _suppressSolvingCyclesRemaining = Math.Max(0, cycles);
        }

        Logger.Log($"[WebSocketTransport] Suppressing next {cycles} solving cycle(s).");
    }

    // -------------------------------------------------------------------------
    // Broadcast helpers
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Generic envelope: `{ type, sessionId, data: <payload> }`. The UI reads such messages via
    ///     `msg.data.<field>` (see the `disconnecting` handler in websocket.svelte.ts).
    ///     Do NOT use this for messages whose TS types expect fields at the top level (e.g.
    ///     `availableParams` on `parametersAdded`) — those need a dedicated flat broadcaster.
    /// </summary>
    public Task BroadcastMessage(string messageType, object data)
    {
        return BroadcastAsync(OutboundEnvelopes.Wrapped(_sessionId, messageType, data));
    }

    /// <summary>
    ///     Broadcast a notification that new parameters were discovered in the document.
    ///     Flat envelope — `availableParams` sits at the top level of the message, matching the
    ///     TS `WsParametersAddedMessage` contract used by the builder.
    /// </summary>
    public Task BroadcastParametersAdded(DiscoveredParameters availableParams)
    {
        return BroadcastAsync(OutboundEnvelopes.ParametersAdded(_sessionId, availableParams));
    }

    public async Task BroadcastOutputsWithFilesAndDisplay(
        Dictionary<string, object> outputs,
        Dictionary<string, object> fileOutputs,
        List<object> displayData,
        bool includeDisplayData = true)
    {
        var doc = RhinoDoc.ActiveDoc;
        var modelUnits = doc?.ModelUnitSystem.ToString() ?? "Meters";

        // Extract binary blobs from DisplayBatch objects so they travel as binary WebSocket frames
        // instead of base64-in-JSON. The SLVA blob contains embedded metadata (materials, groups,
        // sourceComponentId), so no separate envelope is needed.
        //
        // Non-mesh display items (curves, points) have no binary form — they ride the JSON envelope
        // directly as `displayItems`, flattened across all batches (each item already carries a
        // component-derived id). The client tessellates them alongside the mesh frames.
        var binaryBlobs = new List<byte[]>();
        var displayItems = new List<DisplayItem>();
        if (includeDisplayData && displayData != null)
        {
            foreach (var item in displayData)
            {
                if (item is DisplayBatch batch)
                {
                    if (batch.CompressedData != null)
                    {
                        binaryBlobs.Add(batch.CompressedData);
                    }

                    if (batch.Items != null && batch.Items.Count > 0)
                    {
                        displayItems.AddRange(batch.Items);
                    }
                }
            }
        }

        // JSON envelope: omit the raw displayData; include the binary-frame count and any non-mesh
        // display items. `displayItems` is null when empty so mesh-only solves are unchanged.
        await BroadcastAsync(OutboundEnvelopes.Outputs(
            _sessionId, outputs, fileOutputs, binaryBlobs.Count, modelUnits,
            displayItems.Count > 0 ? displayItems : null));

        // Send each binary blob as a separate binary WebSocket frame. WebSocket preserves message
        // order (TCP), so these frames always arrive after the JSON envelope above.
        if (_webSocketServer != null && _webSocketServer.IsRunning)
        {
            foreach (var blob in binaryBlobs)
            {
                await _webSocketServer.BroadcastBinaryAsync(blob);
            }
        }
    }

    public Task BroadcastCurrentValues(Dictionary<string, object> values)
    {
        return BroadcastAsync(OutboundEnvelopes.CurrentValues(_sessionId, values));
    }

    public Task BroadcastSchemaUpdate(UISchema schema, List<Guid> removedIds = null)
    {
        return BroadcastAsync(OutboundEnvelopes.SchemaUpdated(
            _sessionId, schema, SchemaHash.Compute(schema), removedIds));
    }

    public Task BroadcastInitialData(
        UISchema schema,
        DiscoveredParameters availableParams,
        Dictionary<string, object> currentValues)
    {
        bool? solvingState;
        lock (_stateLock)
        {
            solvingState = _lastBroadcastedSolvingState;
        }

        return BroadcastAsync(OutboundEnvelopes.InitialData(
            _sessionId, schema, SchemaHash.Compute(schema), availableParams, currentValues,
            solvingState ?? false));
    }

    public Task BroadcastSchemaSaved(bool success, string message = null)
    {
        return BroadcastAsync(OutboundEnvelopes.SchemaSaved(_sessionId, success, message));
    }

    /// <summary>
    ///     Reply to a save request whose <c>baseSchemaHash</c> no longer matches the
    ///     current canonical. Carries the fresh canonical so the UI can replace its
    ///     read-only mirror and surface a conflict banner.
    /// </summary>
    public Task BroadcastSchemaSaveRejected(UISchema currentSchema, string reason = null)
    {
        return BroadcastAsync(OutboundEnvelopes.SchemaSaveRejected(
            _sessionId, currentSchema, SchemaHash.Compute(currentSchema), reason));
    }

    /// <summary>
    ///     Broadcast solving state with deduplication and cycle-based suppression.
    ///     Thread-safe: may be called from any thread.
    /// </summary>
    public Task BroadcastSolvingState(bool isSolving)
    {
        lock (_stateLock)
        {
            if (_suppressSolvingCyclesRemaining > 0)
            {
                if (!isSolving)
                {
                    _suppressSolvingCyclesRemaining--;
                    Logger.Log(
                        $"[WebSocketTransport] Cycle suppressed ({_suppressSolvingCyclesRemaining} remaining).");
                }
                else
                {
                    Logger.Log($"[WebSocketTransport] Skipping solving state (suppressed): {isSolving}.");
                }

                return Task.CompletedTask;
            }

            if (_lastBroadcastedSolvingState == isSolving)
            {
                Logger.Log($"[WebSocketTransport] Skipping duplicate solving state: {isSolving}.");
                return Task.CompletedTask;
            }

            // Update state only after we've decided to broadcast.
            _lastBroadcastedSolvingState = isSolving;
        }

        return BroadcastAsync(OutboundEnvelopes.SolvingState(_sessionId, isSolving));
    }

    /// <summary>
    ///     Broadcast parameter metadata changes. Suppressed during schema saves. The flat-array
    ///     wire shape (and why the nested DiscoveredParameters object breaks the UI) lives in
    ///     <see cref="OutboundEnvelopes.MetadataUpdated" />, which returns null when there's nothing
    ///     to send.
    /// </summary>
    public Task BroadcastMetadataChanges(DiscoveredParameters changedParams)
    {
        lock (_stateLock)
        {
            if (_suppressSolvingCyclesRemaining > 0)
            {
                return Task.CompletedTask;
            }
        }

        var envelope = OutboundEnvelopes.MetadataUpdated(_sessionId, changedParams);
        return envelope == null ? Task.CompletedTask : BroadcastAsync(envelope);
    }

    public Task BroadcastRuntimeMessage(string level, string messageText)
    {
        return BroadcastAsync(OutboundEnvelopes.RuntimeMessage(
            _sessionId, level, messageText, DateTime.UtcNow));
    }

    public Task BroadcastSyncPreview(SyncDiff syncDiff)
    {
        if (syncDiff == null)
        {
            return Task.CompletedTask;
        }

        return BroadcastAsync(OutboundEnvelopes.SyncPreview(_sessionId, syncDiff));
    }

    public Task BroadcastSyncApplied(bool success, string message = null)
    {
        return BroadcastAsync(OutboundEnvelopes.SyncApplied(_sessionId, success, message));
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Single broadcast entry point — serializes with secure settings and guards
    ///     against a null/stopped server.
    /// </summary>
    private Task BroadcastAsync(object payload)
    {
        if (_webSocketServer == null || !_webSocketServer.IsRunning)
        {
            return Task.CompletedTask;
        }

        // Use the same secure settings for outbound messages for consistency.
        var json = JsonConvert.SerializeObject(payload, SecureSerializerSettings);
        return _webSocketServer.BroadcastAsync(json);
    }

    private void HandleClientConnected(object sender, WebSocket _)
    {
#if DEBUG
        Logger.Log("[WebSocketTransport] WebSocket client connected (waiting for requestInitialData).");
#endif
    }

    private void HandleMessageReceived(object sender, string message)
    {
        // Parse and dispatch on a thread-pool thread so we never block the receive loop.
        _ = Task.Run(() =>
        {
            try
            {
                // Parse/classify is pure (see InboundMessageParser); this method owns only the
                // session-establish in-flight guard, the thread marshalling, and the event raising.
                var inbound = _inboundParser.Parse(message, _sessionId);

                switch (inbound.Kind)
                {
                    case InboundKind.ValueUpdate:
                        MarshalToMainThread(() => OnValuesReceived?.Invoke(this, inbound.Values));
                        break;

                    case InboundKind.RequestCurrentValues:
                        MarshalToMainThread(() => OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty));
                        break;

                    case InboundKind.RequestInitialData:
                        // Guard against concurrent invocations — if the flag is already 1, bail out.
                        if (Interlocked.CompareExchange(ref _initialDataInFlight, 1, 0) != 0)
                        {
                            return;
                        }

                        MarshalToMainThread(() =>
                        {
                            try
                            {
                                OnClientConnected?.Invoke(this, EventArgs.Empty);
                            }
                            finally
                            {
                                Interlocked.Exchange(ref _initialDataInFlight, 0);
                            }
                        });
                        break;

                    case InboundKind.SaveSchema:
                        {
                            var request = new SchemaSaveRequest
                            {
                                Schema = inbound.Schema,
                                BaseSchemaHash = inbound.BaseSchemaHash
                            };
                            MarshalToMainThread(() => OnSchemaSaveRequested?.Invoke(this, request));
                            break;
                        }

                    case InboundKind.RequestSyncPreview:
                        MarshalToMainThread(() => OnSyncPreviewRequested?.Invoke(this, inbound.Schema));
                        break;

                    case InboundKind.ApplySyncChanges:
                        MarshalToMainThread(() => OnSyncChangesApply?.Invoke(this, inbound.Changes));
                        break;

                    case InboundKind.SessionMismatch:
                        Logger.Warn($"[WebSocketTransport] Session ID mismatch for '{inbound.MessageType}'.");
                        break;

                    case InboundKind.MissingField:
                        Logger.Warn($"[WebSocketTransport] '{inbound.MessageType}' missing a required field.");
                        break;

                    case InboundKind.Unknown:
                        Logger.Warn($"[WebSocketTransport] Unknown message type: '{inbound.MessageType}'.");
                        break;

                    case InboundKind.Malformed:
                        Logger.Warn("[WebSocketTransport] Received a malformed message (bad JSON or no type).");
                        break;
                }
            }
            catch (Exception ex)
            {
                Logger.Warn($"[WebSocketTransport] Message error: {ex.Message}");
            }
        });
    }

    /// <summary>
    ///     Marshals a callback to Rhino's UI thread.
    ///     RhinoApp.InvokeOnUiThread is always safe to call — no thread-ID check needed.
    /// </summary>
    private static void MarshalToMainThread(Action callback)
    {
        try
        {
            RhinoApp.InvokeOnUiThread(callback);
        }
        catch (Exception ex)
        {
            // Last-resort fallback: run inline if marshalling failed.
            Logger.Warn($"[WebSocketTransport] InvokeOnUiThread failed, running inline: {ex.Message}");
            callback?.Invoke();
        }
    }
}
