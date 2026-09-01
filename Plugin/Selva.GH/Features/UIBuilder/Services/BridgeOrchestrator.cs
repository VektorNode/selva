using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;
using Selva.Schema.Models;
using Selva.GH.Config;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Goos;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Guards;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Routes WebSocket events between the web UI and the Grasshopper component: value updates,
///     schema save/sync, and output broadcasting.
/// </summary>
public class BridgeOrchestrator : IDisposable
{
    private const int InitialOutputBroadcastDelayMs = AppConfig.UIBuilder.InitialOutputBroadcastDelayMs;

    private readonly WebSocketTransport _webSocketTransport;
    private readonly DocumentEventManager _eventManager;
    private readonly Version _pluginVersion;
    private readonly SchemaSynchronizer _schemaSynchronizer;
    private readonly string _sessionId;
    private readonly ComponentStateManager _stateManager;
    private readonly ValueApplicator _valueApplicator;
    private readonly ValueCollector _valueCollector;

    private GH_Component _component;
    private bool _disposed;
    private Func<UISchema> _getSchema;
    private Action<UISchema> _setSchema;

    public BridgeOrchestrator(
        WebSocketTransport webSocketTransport,
        SchemaSynchronizer schemaSynchronizer,
        ValueApplicator valueApplicator,
        ValueCollector valueCollector,
        ComponentStateManager stateManager,
        DocumentEventManager eventManager,
        Version pluginVersion,
        string sessionId)
    {
        _webSocketTransport = webSocketTransport ?? throw new ArgumentNullException(nameof(webSocketTransport));
        _schemaSynchronizer = schemaSynchronizer ?? throw new ArgumentNullException(nameof(schemaSynchronizer));
        _valueApplicator = valueApplicator ?? throw new ArgumentNullException(nameof(valueApplicator));
        _valueCollector = valueCollector ?? throw new ArgumentNullException(nameof(valueCollector));
        _stateManager = stateManager ?? throw new ArgumentNullException(nameof(stateManager));
        _eventManager = eventManager ?? throw new ArgumentNullException(nameof(eventManager));
        _pluginVersion = pluginVersion ?? throw new ArgumentNullException(nameof(pluginVersion));
        _sessionId = sessionId ?? throw new ArgumentNullException(nameof(sessionId));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        _webSocketTransport.OnValuesReceived -= HandleWebSocketValueUpdate;
        _webSocketTransport.OnCurrentValuesRequested -= HandleCurrentValuesRequest;
        _webSocketTransport.OnClientConnected -= HandleClientConnected;
        _webSocketTransport.OnSchemaSaveRequested -= HandleSchemaSave;
        _webSocketTransport.OnSyncPreviewRequested -= HandleSyncPreviewRequest;
        _webSocketTransport.OnSyncChangesApply -= HandleApplySyncChanges;
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    public void Initialize(
        GH_Component component,
        Func<UISchema> getSchema,
        Action<UISchema> setSchema)
    {
        _component = component ?? throw new ArgumentNullException(nameof(component));
        _getSchema = getSchema ?? throw new ArgumentNullException(nameof(getSchema));
        _setSchema = setSchema ?? throw new ArgumentNullException(nameof(setSchema));

        _webSocketTransport.OnValuesReceived += HandleWebSocketValueUpdate;
        _webSocketTransport.OnCurrentValuesRequested += HandleCurrentValuesRequest;
        _webSocketTransport.OnClientConnected += HandleClientConnected;
        _webSocketTransport.OnSchemaSaveRequested += HandleSchemaSave;
        _webSocketTransport.OnSyncPreviewRequested += HandleSyncPreviewRequest;
        _webSocketTransport.OnSyncChangesApply += HandleApplySyncChanges;
    }

    // -------------------------------------------------------------------------
    // WebSocket event handlers
    // -------------------------------------------------------------------------

    private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
    {
        try
        {
            // A solve is running or scheduled-but-not-started: coalesce (latest wins) instead of
            // dropping. Dropping lost the final slider value when an update landed in the ~1 RTT
            // window before the client's solving mirror caught up. DrainPendingValues applies it
            // on a fresh UI tick once the in-flight solve ends.
            if (_stateManager.IsBusy)
            {
                _stateManager.MergePendingValues(values);
                return;
            }

            ApplyValuesAndSchedule(values);
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeOrchestrator] Error handling value update: {ex.Message}", ex);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
            _ = _webSocketTransport.BroadcastRuntimeMessage("error", $"Error handling value update: {ex.Message}");
        }
    }

    /// <summary>
    ///     Applies a set of values to the live document and schedules a solve. Marks the solve as
    ///     scheduled synchronously, before ScheduleSolution's ~10ms defer elapses, so a value update
    ///     arriving in the schedule-start gap coalesces instead of scheduling a competing solve.
    ///     Re-reads the current schema each call: it may have changed via a save mid-drag.
    /// </summary>
    private void ApplyValuesAndSchedule(Dictionary<string, object> values)
    {
        var document = _component.OnPingDocument();
        var schema = _getSchema();

        if (!DocumentGuards.DocumentAndSchemaValid(document, schema, out _))
        {
            Logger.Warn("[BridgeOrchestrator] Document or schema invalid, skipping value update.");
            _ = _webSocketTransport.BroadcastRuntimeMessage("error", "Document or schema invalid.");
            return;
        }

        var updateCount = _valueApplicator.ApplyValuesAndSchedule(document, schema, values, (level, msg) =>
        {
            _component.AddRuntimeMessage(level, msg);

            if (level == GH_RuntimeMessageLevel.Error || level == GH_RuntimeMessageLevel.Warning)
            {
                _ = _webSocketTransport.BroadcastRuntimeMessage(ConvertMessageLevel(level), msg);
            }
        });

        // Non-zero means a solution was scheduled: ApplyValuesAndSchedule schedules only when at
        // least one parameter expired. Close the schedule-start window before it opens.
        if (updateCount > 0)
        {
            _stateManager.MarkSolveScheduled();
        }
    }

    /// <summary>
    ///     Applies any values that coalesced while a solve was in flight. Called on a fresh UI tick
    ///     after SolutionEnd, never inline in the end handler, which is reentrant (it broadcasts
    ///     outputs, merges bake outputs, etc.). The buffer is taken and cleared first so a value
    ///     changed during the drain solve is captured for the next cycle, not lost.
    /// </summary>
    public void DrainPendingValues()
    {
        if (_disposed)
        {
            return;
        }

        var pending = _stateManager.TakePendingValues();
        if (pending == null || pending.Count == 0)
        {
            return;
        }

        try
        {
            ApplyValuesAndSchedule(pending);
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeOrchestrator] Error draining pending values: {ex.Message}", ex);
        }
    }

    private void HandleClientConnected(object sender, EventArgs e)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (!DocumentGuards.IsValid(document, out _))
            {
                return;
            }

            var contextBake = FindWiredContextBake();
            var schema = ReadSchemaFromContextBake(contextBake);

            if (schema == null)
            {
                if (contextBake == null)
                {
                    _ = _webSocketTransport.BroadcastRuntimeMessage("error",
                        "UIBridge Schema output is not connected to a Context Bake component " +
                        "with param name \"Schema\". Wire it up in Grasshopper first.");
                    _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        "Web UI connected but Schema output is not wired to a Context Bake component " +
                        "with param name \"Schema\".");
                    return;
                }

                // The Context Bake only holds a schema while a solve's volatile data is alive.
                // After a cleared or expired solve it is empty even though the component still
                // holds the real schema: fall back to that before inventing a blank one, or the
                // editor opens on an empty canvas over a definition that still exists.
                schema = _getSchema() ?? CreateDefaultSchema(document);
            }

            var validatedSchema = _schemaSynchronizer.ValidateSchema(schema, document);
#if DEBUG
            Logger.Log($"[UIBuilder] ClientConnected — schema={validatedSchema.Name}, " +
                       $"inputs={validatedSchema.Inputs?.Count}, outputs={validatedSchema.Outputs?.Count}");
#endif

            var currentParams = GetCurrentAvailableParameters(document);
            var currentValues = _valueCollector.CollectInputValues(
                document, validatedSchema, _component.AddRuntimeMessage);

            _ = _webSocketTransport.BroadcastInitialData(validatedSchema, currentParams, currentValues);

            // Also broadcast when the schema declares no outputs but the 3D viewer is on: meshes
            // come from ContextBakes, not declared outputs, so gating on Outputs alone leaves a
            // display-only definition with an empty viewer.
            if (validatedSchema.Outputs?.Count > 0 || (validatedSchema.ViewerOptions?.EnableLocal ?? false))
            {
                ScheduleOutputBroadcast(validatedSchema);
            }
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeOrchestrator] Error sending initial data: {ex.Message}", ex);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error sending initial data: {ex.Message}");
        }
    }

    private void HandleSchemaSave(object sender, SchemaSaveRequest request)
    {
        try
        {
            var schema = request?.Schema;
            if (schema == null)
            {
                _ = _webSocketTransport.BroadcastSchemaSaved(false, "No schema in save request.");
                return;
            }

            var document = _component.OnPingDocument();
            if (document == null)
            {
                _ = _webSocketTransport.BroadcastSchemaSaved(false, "No document available.");
                return;
            }

            if (FindWiredContextBake() == null)
            {
                _ = _webSocketTransport.BroadcastSchemaSaved(false,
                    "Cannot save: UIBridge Schema output is not connected to a Context Bake component.");
                _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    "Schema save rejected: Schema output is not wired to a Context Bake component.");
                return;
            }

            // The UI sends the hash of the canonical it forked from. A mismatch means its draft is
            // stale: reply with the fresh canonical instead of overwriting GH-side changes.
            var currentSchema = _getSchema();
            var verdict = SchemaSaveGuard.Evaluate(currentSchema, schema, request.BaseSchemaHash);
            if (verdict != SchemaSaveVerdict.Accept)
            {
                _ = _webSocketTransport.BroadcastSchemaSaveRejected(currentSchema);
                _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, verdict switch
                {
                    SchemaSaveVerdict.RejectEmptyOverwrite =>
                        "Schema save rejected: the editor sent an empty schema while this component " +
                        "still holds one. Re-solve the definition so the editor loads it, then retry.",
                    SchemaSaveVerdict.RejectMissingBase =>
                        "Schema save rejected: the editor sent no base revision, so it cannot be " +
                        "checked against the stored schema. Reload the editor and retry.",
                    _ => "Schema save rejected: definition changed in Grasshopper since you started editing."
                });
                return;
            }

            schema.ProjectFileName = document.Properties.ProjectFileName;
            schema.DocumentId = document.DocumentID;
            schema.PluginVersion = _pluginVersion.ToString();

            SanitizeSchema(schema);

            // Before validating: the editor's layout is the user's intent, so a widget missing
            // from it stays missing rather than being restored from a tombstone.
            _schemaSynchronizer.AcceptLayoutAsAuthoritative(schema);

            var validatedSchema = _schemaSynchronizer.ValidateSchema(schema, document);
#if DEBUG
            Logger.Log($"[UIBuilder] Save — inputs={validatedSchema.Inputs?.Count}, " +
                       $"outputs={validatedSchema.Outputs?.Count}, " +
                       $"layout={validatedSchema.Layout?.GetType().Name}");
#endif

            _component.Attributes?.DocObject?.RecordUndoEvent("Update Schema");
            _setSchema(validatedSchema);
            _schemaSynchronizer.ApplyParameterAccessFromSchema(validatedSchema, document);
            _schemaSynchronizer.ClearMetadataCache();
            document.Modified();

            // Suppress the re-solve the component-expire call below triggers, or the frontend
            // sees a spurious solving-state flash.
            _webSocketTransport.SuppressSolvingCycles(1);

            // Send the fresh canonical (new hash) before the ack so the UI re-bases its
            // draft and clears isDirty.
            _ = _webSocketTransport.BroadcastSchemaUpdate(validatedSchema);
            _ = _webSocketTransport.BroadcastSchemaSaved(true);

            GHDocumentMutator.ScheduleComponentExpire(document, _component);
#if DEBUG
            Logger.Log("[UIBuilder] Save complete — component expire scheduled.");
#endif
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully.");
        }
        catch (Exception ex)
        {
            _webSocketTransport.SuppressSolvingCycles(0); // clear the suppression, or the next solve stays hidden
            _ = _webSocketTransport.BroadcastSchemaSaved(false, ex.Message);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error saving schema: {ex.Message}");
        }
    }

    private void HandleCurrentValuesRequest(object sender, EventArgs e)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                return;
            }

            var currentValues = _valueCollector.CollectInputValues(
                document, _getSchema(), _component.AddRuntimeMessage);

            _ = _webSocketTransport.BroadcastCurrentValues(currentValues);
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeOrchestrator] Error handling current values request: {ex.Message}", ex);
        }
    }

    private void HandleSyncPreviewRequest(object sender, UISchema schema)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                _ = _webSocketTransport.BroadcastRuntimeMessage("error", "No document available.");
                return;
            }

            _ = _webSocketTransport.BroadcastSyncPreview(
                SchemaSynchronizer.ComputeSyncDiff(schema, document));
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeOrchestrator] Error computing sync preview: {ex.Message}", ex);
            _ = _webSocketTransport.BroadcastRuntimeMessage("error", $"Error computing sync preview: {ex.Message}");
        }
    }

    private void HandleApplySyncChanges(object sender, List<SyncChange> changes)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                _ = _webSocketTransport.BroadcastSyncApplied(false, "No document available.");
                return;
            }

            var currentSchema = _getSchema();
            if (currentSchema == null)
            {
                _ = _webSocketTransport.BroadcastSyncApplied(false, "No schema available.");
                return;
            }

            var updatedSchema = SchemaSynchronizer.ApplySyncChanges(changes, document, currentSchema);
            if (updatedSchema != null)
            {
                _setSchema(updatedSchema);
                document.Modified();
                _ = _webSocketTransport.BroadcastSchemaUpdate(updatedSchema);
            }

            var changedObjects = changes
                .Where(c => Guid.TryParse(c.ParamId, out _))
                .Select(c => document.FindObject(Guid.Parse(c.ParamId), false) as IGH_ActiveObject)
                .Where(o => o != null)
                .ToList();

            GHDocumentMutator.RefreshObjectsOnCanvas(document, changedObjects);
            GHDocumentMutator.ScheduleComponentExpire(document, _component, true);

            _ = _webSocketTransport.BroadcastSyncApplied(true);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Sync changes applied successfully.");
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeOrchestrator] Error applying sync changes: {ex.Message}", ex);
            _ = _webSocketTransport.BroadcastSyncApplied(false, ex.Message);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error applying sync changes: {ex.Message}");
        }
    }

    // -------------------------------------------------------------------------
    // ContextBake helpers: single traversal, used by both connect and save
    // -------------------------------------------------------------------------

    private GH_Component FindWiredContextBake()
    {
        var schemaOutput = _component?.Params.Output.FirstOrDefault(p => p.Name == "Schema");
        if (schemaOutput == null)
        {
            return null;
        }

        foreach (var recipient in schemaOutput.Recipients)
        {
            var comp = recipient?.Attributes?.GetTopLevel?.DocObject as GH_Component;
            if (comp == null)
            {
                continue;
            }

            if (comp.Params.Input.Count == 0 || comp.Params.Input[0].NickName != "Schema")
            {
                continue;
            }

            if (ParameterTypeHelper.IsContextBakeComponent(comp))
            {
                return comp;
            }
        }

        return null;
    }

    private static UISchema ReadSchemaFromContextBake(GH_Component contextBake)
    {
        if (contextBake == null)
        {
            return null;
        }

        var schemaInput = contextBake.Params.Input.FirstOrDefault(p => p.NickName == "Schema");
        var data = schemaInput?.VolatileData?.AllData(true).FirstOrDefault();

        return data is UISchemaGoo goo ? goo.Value : null;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    // Delays reading outputs so the in-flight solve (if any) finishes first.
    private void ScheduleOutputBroadcast(UISchema schema)
    {
        Task.Run(async () =>
        {
            await Task.Delay(InitialOutputBroadcastDelayMs).ConfigureAwait(false);
            RhinoApp.InvokeOnUiThread(new Action(() =>
            {
                if (!_eventManager.CollectAndBroadcastOutputs(schema))
                {
                    RegenerateDisplayData(schema);
                }
            }));
        });
    }

    /// <summary>
    ///     Nothing to replay: the ContextBakes' volatile data is gone (cleared or expired solution),
    ///     which is what a browser sees when it connects before the definition has solved. Expiring
    ///     the ContextBakes re-solves them and everything upstream that feeds them, and the resulting
    ///     SolutionEnd broadcasts the display data, the same effect as rewiring the bake by hand.
    /// </summary>
    private void RegenerateDisplayData(UISchema schema)
    {
        if (!(schema?.ViewerOptions?.EnableLocal ?? false))
        {
            return;
        }

        var document = _component.OnPingDocument();
        if (!DocumentGuards.IsValid(document, out _))
        {
            return;
        }

        var bakes = ValueCollector.FindContextBakes(document);
        if (bakes.Count == 0)
        {
            return;
        }

        document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc =>
        {
            foreach (var bake in bakes)
            {
                bake.ExpireSolution(false);
            }
        });
    }

    private DiscoveredParameters GetCurrentAvailableParameters(GH_Document document)
    {
        if (document == null)
        {
            return new DiscoveredParameters
            {
                SessionId = _sessionId,
                Inputs = new List<DiscoveredInput>(),
                Outputs = new List<DiscoveredOutput>()
            };
        }

        return _schemaSynchronizer.ScanParameters(document, _component);
    }

    private UISchema CreateDefaultSchema(GH_Document document)
    {
        return new UISchema
        {
            Id = Guid.NewGuid().ToString(),
            Name = "New Schema",
            Description = "Configure your Grasshopper UI",
            ProjectFileName = document.Properties.ProjectFileName,
            DocumentId = document.DocumentID,
            PluginVersion = _pluginVersion.ToString(),
            Tags = [],
            Created = DateTime.UtcNow,
            Inputs = [],
            Outputs = [],
            Layout = new TabbedLayoutConfig { Tabs = [] },
            ViewerOptions = new ViewerOptions
            {
                EnableLocal = false,
                EnableRemote = false,
                BackgroundColor = "#f3f3f3"
            },
            InstanceSolve = true
        };
    }

    /// <summary>
    ///     Deduplicates AcceptedFormats on all file inputs before saving.
    /// </summary>
    private static void SanitizeSchema(UISchema schema)
    {
        if (schema?.Layout == null)
        {
            return;
        }

        var groups = schema.Layout switch
        {
            TabbedLayoutConfig tabbed => tabbed.Tabs.SelectMany(t => t.Groups),
            FlatLayoutConfig flat => flat.Groups,
            _ => Enumerable.Empty<GroupConfig>()
        };

        foreach (var item in groups.SelectMany(g => g.Items).OfType<InputFileLayoutItem>())
        {
            if (item.Config?.AcceptedFormats is { Count: > 0 } formats)
            {
                item.Config.AcceptedFormats = formats
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }
        }
    }

    private static string ConvertMessageLevel(GH_RuntimeMessageLevel level)
    {
        return level switch
        {
            GH_RuntimeMessageLevel.Error => "error",
            GH_RuntimeMessageLevel.Warning => "warning",
            GH_RuntimeMessageLevel.Remark => "info",
            _ => "info"
        };
    }
}
