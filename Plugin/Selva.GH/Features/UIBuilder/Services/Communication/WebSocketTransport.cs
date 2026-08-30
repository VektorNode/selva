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
///     Draft schema plus the hash of the canonical it was forked from. The orchestrator
///     rejects the save if the base hash no longer matches the current canonical.
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
    // TypeNameHandling.None blocks type-confusion deserialization attacks.
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

    // Parsing/classifying inbound frames is pure (InboundMessageParser, unit-tested separately);
    // this class owns only the socket, thread marshalling, and event raising.
    private readonly InboundMessageParser _inboundParser = new InboundMessageParser(SecureSerializer);

    // Guards all mutable state touched from multiple threads.
    private readonly object _stateLock = new object();

    // Inbound messages run off the receive loop but chained strictly in arrival order —
    // otherwise two rapid valueUpdates can race and the older value wins.
    private readonly object _dispatchLock = new object();
    private Task _dispatchChain = Task.CompletedTask;

    private bool _disposed;
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
    ///     Generic envelope: `{ type, sessionId, data: &lt;payload&gt; }`; the UI reads it via
    ///     `msg.data.&lt;field&gt;`. Don't use this for messages whose TS type expects fields at the
    ///     top level (e.g. `availableParams` on `parametersAdded`) — use a flat broadcaster instead.
    /// </summary>
    public Task BroadcastMessage(string messageType, object data)
    {
        return BroadcastAsync(OutboundEnvelopes.Wrapped(_sessionId, messageType, data));
    }

    // Flat envelope: availableParams sits at the top level, matching TS WsParametersAddedMessage.
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

        // DisplayBatch blobs travel as binary WebSocket frames instead of base64-in-JSON; the SLVA
        // blob already embeds materials/groups/batchId, so no separate envelope is needed.
        // Non-mesh items (curves, points) have no binary form and ride the JSON envelope as
        // `displayItems`, flattened across all batches. They arrive already tessellated, so the
        // client builds lines straight from them alongside the mesh frames.
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

        // The web renders curves only from `Points`. Anything still lacking them came from a Display
        // component too old to tessellate, and would throw in the viewer with no hint of which
        // definition to fix — so name it here, where the log sits next to the canvas.
        //
        // TRANSITIONAL — goes with WebDisplayGoo.BackfillCurvePoints; see the removal note there.
        var untessellated = 0;
        foreach (var item in displayItems)
        {
            if (item?.Kind == "curve" && item.Points == null)
            {
                untessellated++;
            }
        }

        if (untessellated > 0)
        {
            Logger.Warn(
                $"[WebSocketTransport] {untessellated} curve(s) have no tessellated points and " +
                "will fail to render. Upgrade the Display component in this definition " +
                "(Grasshopper → Solution → Upgrade obsolete components) and re-save.");
        }

        // `displayItems` is null when empty so mesh-only solves stay unchanged on the wire.
        await BroadcastAsync(OutboundEnvelopes.Outputs(
            _sessionId, outputs, fileOutputs, binaryBlobs.Count, modelUnits,
            displayItems.Count > 0 ? displayItems : null));

        // WebSocket preserves order, so these binary frames always arrive after the JSON envelope.
        // Capture the server field once: Stop() can null it from another thread mid-loop.
        var server = _webSocketServer;
        if (server != null && server.IsRunning)
        {
            foreach (var blob in binaryBlobs)
            {
                await server.BroadcastBinaryAsync(blob);
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

    // Reply to a save whose baseSchemaHash no longer matches the canonical. Carries the fresh
    // canonical so the UI can replace its read-only mirror and show a conflict banner.
    public Task BroadcastSchemaSaveRejected(UISchema currentSchema, string reason = null)
    {
        return BroadcastAsync(OutboundEnvelopes.SchemaSaveRejected(
            _sessionId, currentSchema, SchemaHash.Compute(currentSchema), reason));
    }

    // Thread-safe; dedupes repeated states and honors cycle-based suppression.
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

            // Update only after deciding to broadcast, not before.
            _lastBroadcastedSolvingState = isSolving;
        }

        return BroadcastAsync(OutboundEnvelopes.SolvingState(_sessionId, isSolving));
    }

    // Suppressed during schema saves. Wire shape lives in OutboundEnvelopes.MetadataUpdated,
    // which returns null when there's nothing to send.
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

    private Task BroadcastAsync(object payload)
    {
        // Capture once — Stop() can null the field from another thread between check and use.
        var server = _webSocketServer;
        if (server == null || !server.IsRunning)
        {
            return Task.CompletedTask;
        }

        var json = JsonConvert.SerializeObject(payload, SecureSerializerSettings);
        return server.BroadcastAsync(json);
    }

    private void HandleClientConnected(object sender, WebSocket _)
    {
#if DEBUG
        Logger.Log("[WebSocketTransport] WebSocket client connected (waiting for requestInitialData).");
#endif
    }

    private void HandleMessageReceived(object sender, string message)
    {
        // Process on a thread-pool thread so we never block the receive loop, but chain
        // messages so they are handled strictly in arrival order.
        lock (_dispatchLock)
        {
            _dispatchChain = _dispatchChain.ContinueWith(
                _ => ProcessInboundMessage(message),
                CancellationToken.None,
                TaskContinuationOptions.None,
                TaskScheduler.Default);
        }
    }

    private void ProcessInboundMessage(string message)
    {
        try
        {
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
    }

    // RhinoApp.InvokeOnUiThread is always safe to call — no thread-ID check needed.
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
