using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;
using Selva.Core.Models;
using Selva.GH.Config;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Models;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Events;
using Selva.GH.Features.UIBuilder.Services.Persistence;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Features.UIBuilder.Services.State;
using Selva.GH.Features.UIBuilder.Services.Values;
using Selva.GH.Utilities.Guards;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Orchestrates communication between the web UI and Grasshopper component.
///     Handles WebSocket event routing, message processing, and response broadcasting.
/// </summary>
public class BridgeCommunicationService : IDisposable
{
    // Delay before broadcasting initial outputs after client connects.
    // Gives Grasshopper time to finish its current solution before we read output data.
    private const int InitialOutputBroadcastDelayMs = AppConfig.UIBuilder.InitialOutputBroadcastDelayMs;

    private readonly CommunicationHandler _communicationHandler;
    private readonly DocumentEventManager _eventManager;
    private readonly Version _pluginVersion;
    private readonly SchemaManager _schemaManager;
    private readonly string _sessionId;
    private readonly ComponentStateManager _stateManager;
    private readonly ValueApplicator _valueApplicator;
    private readonly ValueCollector _valueCollector;

    private GH_Component _component;
    private bool _disposed;
    private Func<UISchema> _getSchema;
    private Action<UISchema> _setSchema;

    public BridgeCommunicationService(
        CommunicationHandler communicationHandler,
        SchemaManager schemaManager,
        ValueApplicator valueApplicator,
        ValueCollector valueCollector,
        ComponentStateManager stateManager,
        DocumentEventManager eventManager,
        Version pluginVersion,
        string sessionId)
    {
        _communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
        _schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
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

        _communicationHandler.OnValuesReceived -= HandleWebSocketValueUpdate;
        _communicationHandler.OnCurrentValuesRequested -= HandleCurrentValuesRequest;
        _communicationHandler.OnClientConnected -= HandleClientConnected;
        _communicationHandler.OnSchemaSaveRequested -= HandleSchemaSave;
        _communicationHandler.OnSyncPreviewRequested -= HandleSyncPreviewRequest;
        _communicationHandler.OnSyncChangesApply -= HandleApplySyncChanges;
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Initialize the service and wire up WebSocket event handlers.
    /// </summary>
    public void Initialize(
        GH_Component component,
        Func<UISchema> getSchema,
        Action<UISchema> setSchema)
    {
        _component = component ?? throw new ArgumentNullException(nameof(component));
        _getSchema = getSchema ?? throw new ArgumentNullException(nameof(getSchema));
        _setSchema = setSchema ?? throw new ArgumentNullException(nameof(setSchema));

        _communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
        _communicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
        _communicationHandler.OnClientConnected += HandleClientConnected;
        _communicationHandler.OnSchemaSaveRequested += HandleSchemaSave;
        _communicationHandler.OnSyncPreviewRequested += HandleSyncPreviewRequest;
        _communicationHandler.OnSyncChangesApply += HandleApplySyncChanges;
    }

    // -------------------------------------------------------------------------
    // WebSocket event handlers
    // -------------------------------------------------------------------------

    private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
    {
        try
        {
            if (_stateManager.IsSolving)
            {
                Logger.Log("[BridgeCommunicationService] Skipping value update — currently solving.");
                _ = _communicationHandler.BroadcastRuntimeMessage("warning",
                    "Skipping value update — currently solving.");
                return;
            }

            var document = _component.OnPingDocument();
            var schema = _getSchema();

            if (!DocumentGuards.DocumentAndSchemaValid(document, schema, out _))
            {
                Logger.Warn("[BridgeCommunicationService] Document or schema invalid, skipping value update.");
                _ = _communicationHandler.BroadcastRuntimeMessage("error", "Document or schema invalid.");
                return;
            }

            _valueApplicator.ApplyValuesAndSchedule(document, schema, values, (level, msg) =>
            {
                _component.AddRuntimeMessage(level, msg);

                if (level == GH_RuntimeMessageLevel.Error || level == GH_RuntimeMessageLevel.Warning)
                {
                    _ = _communicationHandler.BroadcastRuntimeMessage(ConvertMessageLevel(level), msg);
                }
            });
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeCommunicationService] Error handling value update: {ex.Message}", ex);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
            _ = _communicationHandler.BroadcastRuntimeMessage("error", $"Error handling value update: {ex.Message}");
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

            // Try to read the schema from the wired ContextBake component.
            var contextBake = FindWiredContextBake();
            var schema = ReadSchemaFromContextBake(contextBake);

            if (schema == null)
            {
                if (contextBake == null)
                {
                    // No ContextBake wired at all — refuse and tell the user.
                    _ = _communicationHandler.BroadcastRuntimeMessage("error",
                        "UIBridge Schema output is not connected to a Context Bake component " +
                        "with param name \"Schema\". Wire it up in Grasshopper first.");
                    _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        "Web UI connected but Schema output is not wired to a Context Bake component " +
                        "with param name \"Schema\".");
                    return;
                }

                // ContextBake is wired but no schema saved yet — first-time use.
                schema = CreateDefaultSchema(document);
            }

            var validatedSchema = _schemaManager.ValidateSchema(schema, document);
#if DEBUG
            Logger.Log($"[UIBuilder] ClientConnected — schema={validatedSchema.Name}, " +
                       $"inputs={validatedSchema.Inputs?.Count}, outputs={validatedSchema.Outputs?.Count}");
#endif

            var currentParams = GetCurrentAvailableParameters(document);
            var currentValues = _valueCollector.CollectInputValues(
                document, validatedSchema, _component.AddRuntimeMessage);

            _ = _communicationHandler.BroadcastInitialData(validatedSchema, currentParams, currentValues);

            if (validatedSchema.Outputs?.Count > 0)
            {
                ScheduleOutputBroadcast(validatedSchema);
            }
        }
        catch (Exception ex)
        {
            // Always log — silent swallowing made failures invisible.
            Logger.Error($"[BridgeCommunicationService] Error sending initial data: {ex.Message}", ex);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error sending initial data: {ex.Message}");
        }
    }

    private void HandleSchemaSave(object sender, UISchema schema)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                _ = _communicationHandler.BroadcastSchemaSaved(false, "No document available.");
                return;
            }

            if (FindWiredContextBake() == null)
            {
                _ = _communicationHandler.BroadcastSchemaSaved(false,
                    "Cannot save: UIBridge Schema output is not connected to a Context Bake component.");
                _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    "Schema save rejected: Schema output is not wired to a Context Bake component.");
                return;
            }

            schema.ProjectFileName = document.Properties.ProjectFileName;
            schema.DocumentId = document.DocumentID;
            schema.PluginVersion = _pluginVersion.ToString();

            SanitizeSchema(schema);

            var validatedSchema = _schemaManager.ValidateSchema(schema, document);
#if DEBUG
            Logger.Log($"[UIBuilder] Save — inputs={validatedSchema.Inputs?.Count}, " +
                       $"outputs={validatedSchema.Outputs?.Count}, " +
                       $"layout={validatedSchema.Layout?.GetType().Name}");
#endif

            _component.Attributes?.DocObject?.RecordUndoEvent("Update Schema");
            _setSchema(validatedSchema);
            _schemaManager.ApplyParameterAccessFromSchema(validatedSchema, document);
            _schemaManager.ClearMetadataCache();
            document.Modified();

            // Suppress the re-solve triggered by the component expire below so the
            // frontend does not see a spurious solving-state flash.
            _communicationHandler.SuppressSolvingCycles(1);

            _ = _communicationHandler.BroadcastSchemaSaved(true);

            GHDocumentMutator.ScheduleComponentExpire(document, _component);
#if DEBUG
            Logger.Log("[UIBuilder] Save complete — component expire scheduled.");
#endif
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully.");
        }
        catch (Exception ex)
        {
            // Clear suppression so the next solve is not accidentally hidden.
            _communicationHandler.SuppressSolvingCycles(0);
            _ = _communicationHandler.BroadcastSchemaSaved(false, ex.Message);
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

            _ = _communicationHandler.BroadcastCurrentValues(currentValues);
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeCommunicationService] Error handling current values request: {ex.Message}", ex);
        }
    }

    private void HandleSyncPreviewRequest(object sender, UISchema schema)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                _ = _communicationHandler.BroadcastRuntimeMessage("error", "No document available.");
                return;
            }

            _ = _communicationHandler.BroadcastSyncPreview(
                SchemaManager.ComputeSyncDiff(schema, document));
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeCommunicationService] Error computing sync preview: {ex.Message}", ex);
            _ = _communicationHandler.BroadcastRuntimeMessage("error", $"Error computing sync preview: {ex.Message}");
        }
    }

    private void HandleApplySyncChanges(object sender, List<SyncChange> changes)
    {
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                _ = _communicationHandler.BroadcastSyncApplied(false, "No document available.");
                return;
            }

            var currentSchema = _getSchema();
            if (currentSchema == null)
            {
                _ = _communicationHandler.BroadcastSyncApplied(false, "No schema available.");
                return;
            }

            var updatedSchema = SchemaManager.ApplySyncChanges(changes, document, currentSchema);
            if (updatedSchema != null)
            {
                _setSchema(updatedSchema);
                document.Modified();
                _ = _communicationHandler.BroadcastSchemaUpdate(updatedSchema);
            }

            // Refresh nicknames on the canvas for all changed objects.
            var changedObjects = changes
                .Where(c => Guid.TryParse(c.ParamId, out _))
                .Select(c => document.FindObject(Guid.Parse(c.ParamId), false) as IGH_ActiveObject)
                .Where(o => o != null)
                .ToList();

            GHDocumentMutator.RefreshObjectsOnCanvas(document, changedObjects);
            GHDocumentMutator.ScheduleComponentExpire(document, _component, true);

            _ = _communicationHandler.BroadcastSyncApplied(true);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Sync changes applied successfully.");
        }
        catch (Exception ex)
        {
            Logger.Error($"[BridgeCommunicationService] Error applying sync changes: {ex.Message}", ex);
            _ = _communicationHandler.BroadcastSyncApplied(false, ex.Message);
            _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error applying sync changes: {ex.Message}");
        }
    }

    // -------------------------------------------------------------------------
    // ContextBake helpers — single traversal, used by both connect and save
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Returns the first ContextBakeComponent wired to the UIBridge's Schema output,
    ///     or null if none is connected.
    /// </summary>
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

    /// <summary>
    ///     Reads the UISchema from a ContextBakeComponent's volatile data.
    ///     Returns null if no schema is stored yet (first-time use).
    /// </summary>
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

    /// <summary>
    ///     Defers output broadcasting by <see cref="InitialOutputBroadcastDelayMs" /> to allow
    ///     Grasshopper to finish its current solution before we read output data.
    /// </summary>
    private void ScheduleOutputBroadcast(UISchema schema)
    {
        Task.Run(async () =>
        {
            await Task.Delay(InitialOutputBroadcastDelayMs).ConfigureAwait(false);
            RhinoApp.InvokeOnUiThread(new Action(() =>
                _eventManager.CollectAndBroadcastOutputs(schema)));
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

        return _schemaManager.ScanParameters(document, _component);
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
