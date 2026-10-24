using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Rhino;
using Selva.Schema.Models;
using Selva.GH.Config;
using Selva.GH.Features.SolveRuntime.Services;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;
using Selva.Slva;

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
    private readonly string _bridgeSecret;

    // Parsing/classifying inbound frames is pure (InboundMessageParser, unit-tested separately);
    // this class owns only the socket, thread marshalling, and event raising.
    private readonly InboundMessageParser _inboundParser = new InboundMessageParser(SecureSerializer);

    private readonly HostFileCoordinator _hostFiles;

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

    // Read at acknowledgement and at every filtered message, never captured: Edit in Grasshopper
    // turns a running player session into an author one.
    private Func<BridgeRole> _role = () => BridgeRole.Author;

    public WebSocketTransport(string sessionId, string bridgeSecret, int port = AppConfig.WebSocket.DefaultPort)
    {
        _sessionId = sessionId;
        _bridgeSecret = bridgeSecret ?? throw new ArgumentNullException(nameof(bridgeSecret));
        _port = port;
        _hostFiles = new HostFileCoordinator(new EtoHostFileDialogs(), ModalGate.Shared, MarshalToMainThread,
            sessionId, AppConfig.ValueLimits.MaxFileSizeBytes);
    }

    /// <summary>Where the session's role comes from: the component that owns this transport.</summary>
    public void BindRole(Func<BridgeRole> role)
    {
        _role = role ?? throw new ArgumentNullException(nameof(role));
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
    /// <summary>`requestInitialData`, on the UI thread.</summary>
    public event EventHandler<InboundMessage> OnClientConnected;
    public event EventHandler<SchemaSaveRequest> OnSchemaSaveRequested;
    public event EventHandler<UISchema> OnSyncPreviewRequested;
    public event EventHandler<List<SyncChange>> OnSyncChangesApply;

    /// <summary>
    ///     Raised on the socket's dispatch thread, never marshalled to the UI thread (the solver
    ///     holds it). Handlers may only flip the document's abort flag.
    /// </summary>
    public event EventHandler OnCancelSolveRequested;

    /// <summary>
    ///     The selva* commands, raised on the socket's dispatch thread: each starts network work,
    ///     and the handler hops to the UI thread itself where it touches the document.
    /// </summary>
    public event EventHandler<InboundMessage> OnSelvaCommand;

    /// <summary>`pickGeometry`, on the UI thread. Answered with <see cref="BroadcastPickGeometryResult" />.</summary>
    public event EventHandler<InboundMessage> OnPickGeometryRequested;

    public event EventHandler<Guid> OnClearGeometryRequested;

    public event EventHandler<Guid> OnTriggerRequested;

    /// <summary>`closeDefinition` and `editInGrasshopper`, on the UI thread, from a player session only.</summary>
    public event EventHandler<InboundKind> OnPlayerCommand;

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

    /// <param name="allowedOrigins">Origins whose pages may open a socket: wherever the web UI is served from.</param>
    public async Task StartAsync(Action<string> logMessage, IReadOnlyCollection<string> allowedOrigins)
    {
        if (_webSocketServer?.IsRunning == true)
        {
            return;
        }

        try
        {
            _webSocketServer = new WebSocketServer(_bridgeSecret, allowedOrigins, _port,
                () => BridgeAccess.AuthenticatedMessage(_role()));
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

    public Task BroadcastSolveEvent(SolveEvent solveEvent)
    {
        return BroadcastAsync(OutboundEnvelopes.SolveEvent(_sessionId, solveEvent));
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
        bool includeDisplayData = true,
        SolveDiagnostics diagnostics = null)
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
            displayItems.Count > 0 ? displayItems : null,
            (diagnostics ?? new SolveDiagnostics()).ToOutcome()));

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

    /// <summary>
    ///     Reports a solve that produced no result: refused by a Message component, or aborted.
    /// </summary>
    /// <remarks>
    ///     Deliberately the same <c>outputs</c> envelope with empty outputs and
    ///     <c>binaryBatchCount: 0</c>: the client clears what it was showing, so the previous
    ///     result cannot pass for the answer to the current inputs.
    /// </remarks>
    public Task BroadcastBlockedSolve(SolveDiagnostics diagnostics)
    {
        if (diagnostics == null)
        {
            return Task.CompletedTask;
        }

        var doc = RhinoDoc.ActiveDoc;
        var modelUnits = doc?.ModelUnitSystem.ToString() ?? "Meters";

        return BroadcastAsync(OutboundEnvelopes.Outputs(
            _sessionId,
            new Dictionary<string, object>(),
            new Dictionary<string, object>(),
            binaryBatchCount: 0,
            modelUnits: modelUnits,
            displayItems: null,
            outcome: diagnostics.ToOutcome()));
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

    public Task BroadcastPickGeometryResult(string requestId, Guid paramId, GeometryPickOutcome outcome)
    {
        return BroadcastAsync(OutboundEnvelopes.PickGeometryResult(_sessionId, requestId, paramId,
            outcome.Kind, outcome.Summary, outcome.Error));
    }

    public Task BroadcastSelvaAccount(SelvaAccount account)
    {
        return BroadcastAsync(OutboundEnvelopes.SelvaAccount(_sessionId, account));
    }

    public Task BroadcastSelvaTargets(SelvaTargets targets)
    {
        return BroadcastAsync(OutboundEnvelopes.SelvaTargets(_sessionId, targets));
    }

    public Task BroadcastSelvaUploadProgress(string stage)
    {
        return BroadcastAsync(OutboundEnvelopes.SelvaUploadProgress(_sessionId,
            new SelvaUploadProgress { Stage = stage }));
    }

    public Task BroadcastSelvaUploadResult(SelvaUploadResult result)
    {
        return BroadcastAsync(OutboundEnvelopes.SelvaUploadResult(_sessionId, result));
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
        Logger.Log("[WebSocketTransport] WebSocket client authenticated (waiting for requestInitialData).");
#endif
    }

    private void HandleMessageReceived(object sender, ClientFrame frame)
    {
        // Process on a thread-pool thread so we never block the receive loop, but chain
        // messages so they are handled strictly in arrival order.
        lock (_dispatchLock)
        {
            _dispatchChain = _dispatchChain.ContinueWith(
                _ =>
                {
                    if (frame.Data != null)
                    {
                        ProcessHostFileFrame(frame);
                    }
                    else
                    {
                        ProcessInboundMessage(frame);
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.None,
                TaskScheduler.Default);
        }
    }

    // The only binary frame a page sends is a file to save.
    private void ProcessHostFileFrame(ClientFrame frame)
    {
        try
        {
            if (!IsFromPanel(frame))
            {
                return;
            }

            if (!HostFileFrame.TryDecode(frame.Data, out var headerJson, out var body))
            {
                Logger.Warn("[WebSocketTransport] Dropped a binary frame that isn't a host file frame.");
                return;
            }

            var inbound = _inboundParser.Parse(headerJson, _sessionId);
            if (inbound.Kind != InboundKind.HostSaveFile)
            {
                Logger.Warn($"[WebSocketTransport] Dropped a host file frame of kind {inbound.Kind}.");
                return;
            }

            _hostFiles.HandleSave(inbound.RequestId, inbound.FileName, body, new SocketReply(this, frame.Client));
        }
        catch (Exception ex)
        {
            Logger.Warn($"[WebSocketTransport] Host file frame error: {ex.Message}");
        }
    }

    private static bool IsFromPanel(ClientFrame frame)
    {
        if (frame.Host == BridgeAccess.PanelHost)
        {
            return true;
        }

        Logger.Warn("[WebSocketTransport] Refused a file dialog request from a browser tab.");
        return false;
    }

    private void ProcessInboundMessage(ClientFrame frame)
    {
        try
        {
            var inbound = _inboundParser.Parse(frame.Text, _sessionId);

            // Hiding the builder on the page isn't enough: the socket itself must not write.
            if (BridgeAccess.IsRefused(inbound.Kind, _role()))
            {
                Logger.Warn($"[WebSocketTransport] Refused '{inbound.MessageType}' in a {BridgeAccess.RoleName(_role())} session.");
                return;
            }

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
                            OnClientConnected?.Invoke(this, inbound);
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

                case InboundKind.CancelSolve:
                    // Deliberately NOT marshalled: the solver occupies the UI thread, so a
                    // marshalled cancel would queue behind the very solve it is meant to stop.
                    // The handler only flips the document's abort flag, which is safe here.
                    OnCancelSolveRequested?.Invoke(this, EventArgs.Empty);
                    break;

                case InboundKind.SelvaGetAccount:
                case InboundKind.SelvaConnect:
                case InboundKind.SelvaSignIn:
                case InboundKind.SelvaUseApiKey:
                case InboundKind.SelvaSignOut:
                case InboundKind.SelvaListTargets:
                case InboundKind.SelvaUpload:
                case InboundKind.SelvaCancel:
                    OnSelvaCommand?.Invoke(this, inbound);
                    break;

                case InboundKind.HostPickFile:
                    if (IsFromPanel(frame))
                    {
                        _hostFiles.HandlePick(inbound.RequestId, inbound.Accept, new SocketReply(this, frame.Client));
                    }

                    break;

                case InboundKind.HostSaveFile:
                    Logger.Warn("[WebSocketTransport] Dropped a hostSaveFile sent as text; it travels as a binary frame.");
                    break;

                case InboundKind.PickGeometry:
                    MarshalToMainThread(() => OnPickGeometryRequested?.Invoke(this, inbound));
                    break;

                case InboundKind.ClearGeometry:
                    MarshalToMainThread(() => OnClearGeometryRequested?.Invoke(this, inbound.ParamId));
                    break;

                case InboundKind.Trigger:
                    MarshalToMainThread(() => OnTriggerRequested?.Invoke(this, inbound.ParamId));
                    break;

                case InboundKind.CloseDefinition:
                case InboundKind.EditInGrasshopper:
                    MarshalToMainThread(() => OnPlayerCommand?.Invoke(this, inbound.Kind));
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

    /// <summary>Sends to the socket the request came from, through whichever server is running at reply time.</summary>
    private sealed class SocketReply : IHostFileReply
    {
        private readonly WebSocket _client;
        private readonly WebSocketTransport _transport;

        public SocketReply(WebSocketTransport transport, WebSocket client)
        {
            _transport = transport;
            _client = client;
        }

        public Task SendAsync(object envelope)
        {
            var server = _transport._webSocketServer;
            return server == null
                ? Task.CompletedTask
                : server.SendAsync(_client, JsonConvert.SerializeObject(envelope, SecureSerializerSettings));
        }

        public Task SendFileAsync(object header, byte[] body)
        {
            var server = _transport._webSocketServer;
            return server == null
                ? Task.CompletedTask
                : server.SendBinaryAsync(_client,
                    HostFileFrame.Encode(JsonConvert.SerializeObject(header, SecureSerializerSettings), body));
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
