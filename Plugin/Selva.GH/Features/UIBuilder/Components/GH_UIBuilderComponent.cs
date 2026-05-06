using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Rhino;
using Selva.Schema.Models;
using Selva.Schema.Services;
using Selva.GH.Config;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Goos;
using Selva.GH.Features.UIBuilder.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities.Guards;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Components;

/// <summary>
///     Unified UI Builder component - WebSocket-only version
///     Switch between Schema Builder mode and Interactive Preview mode
/// </summary>
public class GH_UIBuilderComponent : GH_Component, IDisposable
{
    private static readonly Version PluginVersion = typeof(GH_UIBuilderComponent).Assembly.GetName().Version;

    // Document tracking
    private GH_Document _currentDocument;
    private bool _disposed;
    private UISchema _embeddedSchema;
    private Dictionary<string, object> _embeddedValues;
    private EventHandler _onDocumentModified;
    private EventHandler _onSolutionEnded;

    // Named event handler references so they can be unsubscribed on Dispose
    private EventHandler _onSolutionStarted;
    private UIBuilderService _service;
    private string _sessionId;

    public GH_UIBuilderComponent()
        : base("UI Bridge", "UIBridge",
            "Build and interact with your UI - WebSocket-only communication",
            "Selva", "UI")
    {
    }

    /// <summary>
    ///     Helper property to check if WebSocket communication is available
    /// </summary>
    private bool IsConnected => _service?.WebSocketTransport?.IsRunning == true;

    public override Guid ComponentGuid => new Guid("D4E5F6A7-B8C9-4D5E-0F1A-2B3C4D5E6F7A");

    protected override Bitmap Icon => Resources.UIBridge;

    /// <summary>
    ///     Override Locked property to handle right-click disable/enable
    /// </summary>
    public override bool Locked
    {
        get => base.Locked;
        set
        {
            // If component is being locked (disabled), cleanup communication and events
            if (value && !base.Locked)
            {
                CleanupCommunication();
                _service?.EventManager?.UnregisterEvents();
            }

            base.Locked = value;
        }
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    ~GH_UIBuilderComponent()
    {
        Dispose(false);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddBooleanParameter("Enable", "Enable", "Enable UI Builder (opens web interface)",
            GH_ParamAccess.item, false);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Schema", "Schema", "Current UI schema", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        // Check if running in headless/compute environment before any initialization
        // If so, just output the embedded schema and stop - no services or background tasks
        if (RhinoApp.IsRunningHeadless || RhinoDoc.ActiveDoc == null || RhinoDoc.ActiveDoc.IsHeadless)
        {
            DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
            return;
        }

        var enable = false;
        DA.GetData(0, ref enable);

        // Initialize dependencies on first run
        InitializeDependencies();


        var document = OnPingDocument();
        if (!DocumentGuards.IsValid(document, out var error))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, error);
            DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
            return;
        }

        var transition = _service.StateManager.ProcessEnableInput(enable);

        if (transition.EnableFalling)
        {
            HandleDisablingState(document);
        }

        // Register document events only when enabled
        if (enable)
        {
            if (_currentDocument != document)
            {
                _currentDocument = document;
            }

            _service.EventManager.RegisterEvents(document);
        }

        // Handle current state
        if (enable)
        {
            HandleEnabledState(DA, document, transition);
        }
        else
        {
            HandleDisabledState(DA, document);
        }
    }

    /// <summary>
    ///     Initialize all dependencies on first run
    /// </summary>
    private void InitializeDependencies()
    {
        if (_service != null)
        {
            return;
        }

        // Always generate a new session ID on first initialization (don't restore from file)
        _sessionId = new SessionManager().CreateNewSession();

        // Now create UIBuilderService with the correct session ID
        _service = new UIBuilderService(_sessionId, PluginVersion);

        // Initialize BridgeService and DocumentSyncService with callbacks for single source of truth
        _service.BridgeService.Initialize(
            this,
            () => _embeddedSchema,
            schema => _embeddedSchema = schema
        );
        _service.DocumentSyncService.Initialize(
            this,
            _currentDocument,
            () => _embeddedSchema,
            () => _embeddedValues,
            schema => _embeddedSchema = schema
        );

        // Wire up parameter deletion handler
        _service.DocumentSyncService.OnParameterDeletionRequired += HandleParameterDeletion;

        // Keep watched set in sync when new params are merged into the schema
        _service.DocumentSyncService.OnNewIdsDiscovered += ids =>
            _service.EventManager.RegisterWatchedIds(ids);

        // Wire up solution events — stored as named fields so they can be unsubscribed on Dispose
        _onSolutionStarted = (s, e) =>
        {
#if DEBUG
            Logger.Log("[UIBuilder] SolutionStart");
#endif
            _service.StateManager.SetSolving(true);
        };
        _onSolutionEnded = (s, e) =>
        {
            var wasActuallySolving = _service.StateManager.SetSolving(false);
#if DEBUG
            Logger.Log($"[UIBuilder] SolutionEnd — wasActuallySolving={wasActuallySolving}");
#endif
            if (wasActuallySolving)
            {
                _service.EventManager.CollectAndBroadcastOutputs(_embeddedSchema);
                _service.EventManager.DetectAndBroadcastMetadataChanges(_embeddedSchema);

                // Sync ContextBake outputs: add newly-qualifying, remove unwired ones
                if (_embeddedSchema != null)
                {
                    var document = OnPingDocument();
                    var (addedIds, removedIds) =
                        _service.SchemaSynchronizer.MergePostSolveBakeOutputs(_embeddedSchema, document);
                    if (addedIds.Count > 0 || removedIds.Count > 0)
                    {
                        if (addedIds.Count > 0)
                        {
                            _service.EventManager.RegisterWatchedIds(addedIds);
                        }

                        _ = _service.WebSocketTransport
                            .BroadcastSchemaUpdate(_embeddedSchema, removedIds.Count > 0 ? removedIds : null)
                            .ContinueWith(t =>
                            {
                                if (t.IsFaulted)
                                {
                                    Logger.Error("Failed to broadcast schema update after bake output sync",
                                        t.Exception);
                                }
                            });
                        GHDocumentMutator.ScheduleComponentExpire(document, this, true);
                    }
                }
            }

            ClearAllContextualParameters();
        };
        _onDocumentModified = (s, e) =>
        {
            if (_embeddedSchema != null)
            {
                _service.EventManager.DetectAndBroadcastMetadataChanges(_embeddedSchema);
            }
        };

        _service.EventManager.SolutionStarted += _onSolutionStarted;
        _service.EventManager.SolutionEnded += _onSolutionEnded;
        _service.EventManager.DocumentModified += _onDocumentModified;
    }


    /// <summary>
    ///     Handle enabled state
    /// </summary>
    private void HandleEnabledState(IGH_DataAccess DA, GH_Document document, StateTransition transition)
    {
        if (!_service.ServerManager.IsRunning)
        {
            // Start servers using the ServerLifecycleManager (async fire-and-forget)
            _ = Task.Run(async () =>
            {
                try
                {
                    var started = await _service.ServerManager.StartServersAsync(_sessionId);

                    if (started)
                    // Show Web UI URL if embedded assets are available
                    {
                        if (_service.ServerManager.HttpPort.HasValue)
                        {
                            var wsPort = _service.ServerManager.WebSocketPort ?? AppConfig.WebSocket.DefaultPort;
                            var httpPort = _service.ServerManager.HttpPort.Value;
                            RhinoApp.InvokeOnUiThread(new Action(() =>
                            {
                                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                                    $"Web UI available at: http://localhost:{httpPort}/?session={_sessionId}&wsPort={wsPort}");
                            }));
                        }
                    }
                }
                catch (Exception ex)
                {
                    RhinoApp.InvokeOnUiThread(new Action(() =>
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to start servers: {ex.Message}");
                    }));
                }
            });

            Message = ComponentMessageFormatter.CreateDisplayMessage(true, true, _embeddedSchema, _sessionId);
        }

        if (_embeddedSchema != null && transition.EnableRising)
        {
            // Remove any parameters deleted while component was off
            _embeddedSchema = _service.SchemaSynchronizer.ValidateSchema(_embeddedSchema, document);
            // Reconcile nicknames renamed while component was off (or Rhino was closed)
            _service.SchemaSynchronizer.SyncNicknamesFromDocument(_embeddedSchema, document);
            // Seed the watched set so UndoStateChanged can short-circuit correctly
            _service.EventManager.RegisterWatchedObjects(_embeddedSchema);
        }

        DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
    }

    /// <summary>
    ///     Handle transition to disabled state
    /// </summary>
    private void HandleDisablingState(GH_Document document)
    {
        CleanupCommunication();
        _service?.EventManager?.UnregisterEvents();

        var contextualParams = document.Objects.OfType<IGH_ContextualParameter>().ToList();
        ParameterTypeHelper.ClearContextualParameters(contextualParams, this);
        _service?.ValueApplicator?.Clear();
    }

    /// <summary>
    ///     Handle disabled state display
    /// </summary>
    private void HandleDisabledState(IGH_DataAccess DA, GH_Document document)
    {
        DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
        Message = ComponentMessageFormatter.CreateDisplayMessage(false, false, _embeddedSchema, _sessionId);
    }

    /// <summary>
    ///     Handle value updates received via WebSocket
    /// </summary>
    /// <summary>
    ///     Transactional deletion handler - delegates to SchemaCleanupService
    /// </summary>
    private void HandleParameterDeletion(List<Guid> removedIds, GH_Document document)
    {
        _service.CleanupService.CleanupDeletedParameters(
            removedIds,
            _embeddedSchema,
            _service.ValueApplicator,
            _embeddedValues,
            _service.WebSocketTransport,
            document,
            AddRuntimeMessage
        );
    }

    private void OpenUI()
    {
        try
        {
            // Get WebSocket port from WebSocketTransport
            var wsPort = _service?.WebSocketTransport?.WebSocketPort ?? AppConfig.WebSocket.DefaultPort;

            // Use embedded web server if available, otherwise fall back to dev server
            var url = _service?.WebServer?.IsRunning == true
                ? $"{_service.WebServer.BaseUrl}/?session={_sessionId}&wsPort={wsPort}"
                : $"http://localhost:5173/?session={_sessionId}&wsPort={wsPort}";

            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Could not open browser: {ex.Message}");
        }
    }

    /// <summary>
    ///     Add custom context menu items to the component's right-click menu
    /// </summary>
    public override bool AppendMenuItems(ToolStripDropDown menu)
    {
        base.AppendMenuItems(menu);

        menu.Items.Add(new ToolStripSeparator());

        var openUIItem = new ToolStripMenuItem(
            "Open UI in Browser",
            null,
            (s, e) => OpenUI()
        )
        {
            ToolTipText = "Open the interactive UI preview in your default web browser"
        };

        // Only enable if the component is active and connected
        openUIItem.Enabled = _service?.StateManager != null && IsConnected;

        menu.Items.Add(openUIItem);

        return true;
    }

    public override void RemovedFromDocument(GH_Document document)
    {
        base.RemovedFromDocument(document);
        Cleanup();
    }

    private static readonly Guid BooleanToggleGuid = new Guid("2e78987b-9dfb-42a2-8b76-3923ac8bd91a");
    private static readonly Guid HopsContextBakeGuid = new Guid("ae2531b4-bab2-4bb1-b5bf-f2143d10c132");

    public override void AddedToDocument(GH_Document document)
    {
        base.AddedToDocument(document);

        if (document == null || !IsFreshPlacement())
        {
            return;
        }

        try
        {
            WireDefaultNeighbors(document);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Auto-wire on placement failed: {ex.Message}");
        }
    }

    /// <summary>
    ///     True only when this component was just dropped on a fresh canvas position —
    ///     not on file load, paste, or when the user has already wired/loaded state.
    /// </summary>
    private bool IsFreshPlacement()
    {
        if (_embeddedSchema != null)
        {
            return false;
        }

        if (Params.Input.Count > 0 && Params.Input[0].SourceCount > 0)
        {
            return false;
        }

        if (Params.Output.Count > 0 && Params.Output[0].Recipients.Count > 0)
        {
            return false;
        }

        return true;
    }

    private void WireDefaultNeighbors(GH_Document document)
    {
        const float gap = 40f;

        if (Attributes == null)
        {
            return;
        }

        Attributes.PerformLayout();
        var selfBounds = Attributes.Bounds;
        var centerY = selfBounds.Y + selfBounds.Height / 2f;

        var toggle = Grasshopper.Instances.ComponentServer.EmitObject(BooleanToggleGuid) as IGH_Param;
        if (toggle != null && Params.Input.Count > 0)
        {
            document.AddObject(toggle, false);
            if (toggle.Attributes != null)
            {
                toggle.Attributes.Pivot = new PointF(selfBounds.Left - gap, centerY);
                toggle.Attributes.ExpireLayout();
                toggle.Attributes.PerformLayout();

                var tBounds = toggle.Attributes.Bounds;
                var dx = (selfBounds.Left - gap) - tBounds.Right;
                var dy = centerY - (tBounds.Y + tBounds.Height / 2f);
                toggle.Attributes.Pivot = new PointF(toggle.Attributes.Pivot.X + dx, toggle.Attributes.Pivot.Y + dy);
                toggle.Attributes.ExpireLayout();
            }
            Params.Input[0].AddSource(toggle);
        }

        var bake = Grasshopper.Instances.ComponentServer.EmitObject(HopsContextBakeGuid);
        if (bake is IGH_Component bakeComponent && Params.Output.Count > 0 && bakeComponent.Params.Input.Count > 0)
        {
            document.AddObject(bakeComponent, false);
            if (bakeComponent.Attributes != null)
            {
                bakeComponent.Attributes.Pivot = new PointF(selfBounds.Right + gap, centerY);
                bakeComponent.Params.Input[0].NickName = "Schema";
                bakeComponent.Attributes.ExpireLayout();
                bakeComponent.Attributes.PerformLayout();

                var bBounds = bakeComponent.Attributes.Bounds;
                var dx = (selfBounds.Right + gap) - bBounds.Left;
                var dy = centerY - (bBounds.Y + bBounds.Height / 2f);
                bakeComponent.Attributes.Pivot = new PointF(bakeComponent.Attributes.Pivot.X + dx, bakeComponent.Attributes.Pivot.Y + dy);
                bakeComponent.Attributes.ExpireLayout();
            }
            bakeComponent.Params.Input[0].AddSource(Params.Output[0]);
        }
    }

    /// <summary>
    ///     Clear contextual data from all inputs and outputs after each solve
    /// </summary>
    private void ClearAllContextualParameters()
    {
        var document = OnPingDocument();
        if (document == null)
        {
            return;
        }

        try
        {
            // Clear all contextual input parameters
            var contextualParams = document.Objects.OfType<IGH_ContextualParameter>().ToList();
            foreach (var contextParam in contextualParams)
            {
                var clearMethod = contextParam.GetType().GetMethod("ClearContextualData");
                clearMethod?.Invoke(contextParam, null);
            }

            // Clear context output components (ContextPrintComponent)
            foreach (var obj in document.Objects)
            {
                if (ParameterTypeHelper.IsContextOutputComponent(obj) ||
                    ParameterTypeHelper.IsContextBakeComponent(obj))
                {
                    var clearMethod = obj.GetType().GetMethod("ClearContextualData");
                    clearMethod?.Invoke(obj, null);
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error clearing contextual data: {ex.Message}");
        }
    }

    /// <summary>
    ///     Cleanup communication servers and notify clients
    /// </summary>
    private void CleanupCommunication()
    {
        if (_service?.ServerManager != null)
        {
            try
            {
                // Use ServerLifecycleManager to stop servers and notify clients
                _ = _service.ServerManager.StopServersAndNotifyAsync("Component disabled");
            }
            catch (Exception ex)
            {
                Logger.Warn($"Error during communication cleanup: {ex.Message}");
            }
        }
    }

    private void Cleanup()
    {
        CleanupCommunication();

        if (_service?.EventManager != null)
        {
            _service.EventManager.SolutionStarted -= _onSolutionStarted;
            _service.EventManager.SolutionEnded -= _onSolutionEnded;
            _service.EventManager.DocumentModified -= _onDocumentModified;
            _service.EventManager.UnregisterEvents();
        }

        _service?.ValueApplicator?.Clear();
        _service?.SchemaSynchronizer?.ClearMetadataCache();
        _service?.StateManager?.Reset();
        _currentDocument = null;
    }

    protected virtual void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (disposing)
        {
            Cleanup();
            _service?.Dispose();
        }

        _disposed = true;
    }

    // Schema persistence - save/load with .gh file
    public override bool Write(GH_IWriter writer)
    {
        // Use persistence service to save schema and values
        if (_service?.PersistenceService != null)
        {
            try
            {
                var lastValues = _service.ValueApplicator?.GetLastAppliedValues();
                _service.PersistenceService.SerializeToArchive(writer, _embeddedSchema, lastValues);
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Could not save schema/values: {ex.Message}");
            }
        }

        // Append to schema history on every GH file save
        if (_embeddedSchema != null)
        {
            try
            {
                var doc = OnPingDocument();
                var documentId = doc?.DocumentID ?? Guid.Empty;
                if (documentId != Guid.Empty)
                {
                    SchemaBackupService.AppendHistory(
                        _embeddedSchema,
                        documentId,
                        Logger.Warn
                    );
                }
            }
            catch (Exception ex)
            {
                Logger.Warn($"Could not write schema history: {ex.Message}");
            }
        }

        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        if (reader.ItemExists("Schema") || reader.ItemExists("Values"))
        {
            try
            {
                var persistenceService = new SchemaArchiveSerializer(PluginVersion);
                var result = persistenceService.DeserializeFromArchive(reader);

                if (result.HasValue)
                {
                    _embeddedSchema = result.Value.schema;
                    _embeddedValues = result.Value.values;
                }
            }
            catch (InvalidOperationException ex)
            {
                if (ex.InnerException is IncompatibleSchemaException)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.InnerException.Message);
                    return false;
                }

                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Could not load data: {ex.Message}");
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Could not load data: {ex.Message}");
            }
        }

        return base.Read(reader);
    }
}
