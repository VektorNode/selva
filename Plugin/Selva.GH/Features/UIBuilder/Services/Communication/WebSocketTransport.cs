using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino;
using Selva.Schema.Models;
using Selva.GH.Config;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

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
    public event EventHandler<UISchema> OnSchemaSaveRequested;
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

    public Task BroadcastMessage(string messageType, object data)
    {
        return BroadcastAsync(new { type = messageType, sessionId = _sessionId, data });
    }

    public async Task BroadcastOutputsWithFilesAndDisplay(
        Dictionary<string, object> outputs,
        Dictionary<string, object> fileOutputs,
        List<object> displayData,
        bool includeDisplayData = true)
    {
        var doc = RhinoDoc.ActiveDoc;
        var modelUnits = doc?.ModelUnitSystem.ToString() ?? "Meters";

        // Extract binary blobs from MeshBatch objects so they travel as binary WebSocket frames
        // instead of base64-in-JSON. The SLVA blob contains embedded metadata (materials, groups,
        // sourceComponentId), so no separate envelope is needed.
        var binaryBlobs = new List<byte[]>();
        if (includeDisplayData && displayData != null)
        {
            foreach (var item in displayData)
            {
                if (item is MeshBatch batch && batch.CompressedData != null)
                {
                    binaryBlobs.Add(batch.CompressedData);
                }
            }
        }

        // JSON envelope: omit displayData; include count so the client knows how many binary
        // frames to collect before processing the scene update.
        await BroadcastAsync(new
        {
            type = "outputs",
            sessionId = _sessionId,
            outputs,
            fileOutputs,
            binaryBatchCount = binaryBlobs.Count,
            modelUnits
        });

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
        return BroadcastAsync(new { type = "currentValues", sessionId = _sessionId, values });
    }

    public Task BroadcastSchemaUpdate(UISchema schema, List<Guid> removedIds = null)
    {
        return BroadcastAsync(new
        {
            type = "schemaUpdated",
            sessionId = _sessionId,
            schema,
            removedIds = removedIds ?? new List<Guid>()
        });
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

        return BroadcastAsync(new
        {
            type = "initialData",
            sessionId = _sessionId,
            schema,
            availableParams,
            currentValues,
            isSolving = solvingState ?? false
        });
    }

    public Task BroadcastSchemaSaved(bool success, string message = null)
    {
        return BroadcastAsync(new { type = "schemaSaved", sessionId = _sessionId, success, message });
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

        return BroadcastAsync(new { type = "solvingState", sessionId = _sessionId, isSolving });
    }

    /// <summary>
    ///     Broadcast parameter metadata changes. Suppressed during schema saves.
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

        if (changedParams == null)
        {
            return Task.CompletedTask;
        }

        if ((changedParams.Inputs?.Count ?? 0) == 0 && (changedParams.Outputs?.Count ?? 0) == 0)
        {
            return Task.CompletedTask;
        }

        return BroadcastAsync(new
        {
            type = "metadataUpdated",
            sessionId = _sessionId,
            changedParams
        });
    }

    public Task BroadcastRuntimeMessage(string level, string messageText)
    {
        return BroadcastAsync(new
        {
            type = "runtimeMessage",
            sessionId = _sessionId,
            level,
            message = messageText,
            timestamp = DateTime.UtcNow
        });
    }

    public Task BroadcastSyncPreview(SyncDiff syncDiff)
    {
        if (syncDiff == null)
        {
            return Task.CompletedTask;
        }

        return BroadcastAsync(new
        {
            type = "syncPreview",
            sessionId = _sessionId,
            fromGH = syncDiff.FromGH,
            toGH = syncDiff.ToGH
        });
    }

    public Task BroadcastSyncApplied(bool success, string message = null)
    {
        return BroadcastAsync(new
        {
            type = "syncApplied",
            sessionId = _sessionId,
            success,
            message = message ?? (success ? "Sync completed successfully" : "Sync failed")
        });
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
                var jObj = JObject.Parse(message);
                var msgType = jObj["type"]?.ToString();
                var sid = jObj["sessionId"]?.ToString();

                // requestInitialData establishes the session — exempt from session check.
                if (msgType != "requestInitialData" && sid != _sessionId)
                {
                    Logger.Warn($"[WebSocketTransport] Session ID mismatch for '{msgType}'.");
                    return;
                }

                switch (msgType)
                {
                    case "valueUpdate":
                        {
                            var values = jObj["values"]?.ToObject<Dictionary<string, object>>(SecureSerializer);
                            if (values != null)
                            {
                                MarshalToMainThread(() => OnValuesReceived?.Invoke(this, values));
                            }
                            else
                            {
                                Logger.Warn("[WebSocketTransport] valueUpdate missing 'values'.");
                            }

                            break;
                        }

                    case "requestCurrentValues":
                        MarshalToMainThread(() => OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty));
                        break;

                    case "requestInitialData":
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

                    case "saveSchema":
                        {
                            var schema = jObj["schema"]?.ToObject<UISchema>(SecureSerializer);
                            if (schema != null)
                            {
                                MarshalToMainThread(() => OnSchemaSaveRequested?.Invoke(this, schema));
                            }

                            break;
                        }

                    case "requestSyncPreview":
                        {
                            var schema = jObj["schema"]?.ToObject<UISchema>(SecureSerializer);
                            if (schema != null)
                            {
                                MarshalToMainThread(() => OnSyncPreviewRequested?.Invoke(this, schema));
                            }

                            break;
                        }

                    case "applySyncChanges":
                        {
                            var changes = jObj["changes"]?.ToObject<List<SyncChange>>(SecureSerializer);
                            if (changes != null)
                            {
                                MarshalToMainThread(() => OnSyncChangesApply?.Invoke(this, changes));
                            }

                            break;
                        }

                    default:
                        Logger.Warn($"[WebSocketTransport] Unknown message type: '{msgType}'.");
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
