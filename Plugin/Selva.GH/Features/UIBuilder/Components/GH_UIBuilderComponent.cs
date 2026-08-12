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
///     DO NOT RENAME THIS CLASS. Rhino.Compute identifies it by literal type name
///     ("GH_UIBuilderComponent") in GrasshopperValidationHelper.cs — it cannot reference Selva.GH,
///     so there is no `is` check and no compile-time link. A rename compiles clean here and breaks
///     /grasshopper/schema for EVERY definition at once, blaming the user's Context Bake wiring.
///     Nothing in either repo catches this: the boundary has no test. If you must rename, update
///     the compute fork in the same change.
///
///     Same applies to OBSOLETE_* snapshots: they must keep subclassing this component. Compute
///     walks the base chain to accept them (a pre-upgrade .gh deserializes into the subclass, and
///     the IGH_UpgradeObject only runs on an interactive right-click → Upgrade, never headlessly).
///     A standalone copy-pasted snapshot is not a GH_UIBuilderComponent and will be rejected.
/// </summary>
public class GH_UIBuilderComponent : GH_Component, IDisposable
{
    private static readonly Version PluginVersion = typeof(GH_UIBuilderComponent).Assembly.GetName().Version;

    private GH_Document _currentDocument;
    private bool _disposed;

    // DO NOT RENAME. Rhino.Compute reads this field by literal name via reflection
    // (GrasshopperValidationHelper.GetEmbeddedSchema) to serve /grasshopper/schema without
    // solving. A rename compiles clean and makes every definition report "no embedded schema".
    private UISchema _embeddedSchema;
    private Dictionary<string, object> _embeddedValues;
    private EventHandler _onDocumentModified;
    private EventHandler _onSolutionEnded;
    private EventHandler _onSolutionStarted;
    private UIBuilderService _service;
    private string _sessionId;

    public GH_UIBuilderComponent()
        : base("UI Bridge", "UIBridge",
            "Build and interact with your UI - WebSocket-only communication",
            "Selva", "UI")
    {
    }

    private bool IsConnected => _service?.WebSocketTransport?.IsRunning == true;

    public override Guid ComponentGuid => new Guid("593BC967-797A-4B1A-9B76-C2133F6B08E2");

    /// <summary>
    ///     Normally authored through the designer and restored by <see cref="Read" />; this setter
    ///     exists so a definition can be built without one — scripted fixture generation, tests.
    ///     Setting expires the solution so the Schema output republishes.
    /// </summary>
    public UISchema Schema
    {
        get => _embeddedSchema;
        set
        {
            _embeddedSchema = value;
            ExpireSolution(false);
        }
    }

    protected override Bitmap Icon => Resources.UIBridge;

    /// <summary>
    ///     Locking tears down document subscriptions without a falling edge, so the solve after
    ///     unlock sees EnableRising == false. SolveInstance also keys the rebind on
    ///     EventManager.IsRegistered — don't narrow that condition back to edges only.
    ///
    ///     Lock only tears down what InitializeDependencies wires per-document (servers +
    ///     DocumentEventManager document-side subscriptions). It does NOT detach the component-side
    ///     handlers (_onSolutionStarted/_onSolutionEnded/_onDocumentModified) — those are bound once
    ///     in InitializeDependencies and stay attached for the component's lifetime; Cleanup()/
    ///     Dispose() detach them.
    ///
    ///     If UnregisterEvents ever starts clearing EventManager's SolutionStarted/SolutionEnded/
    ///     DocumentModified subscriber lists too, this contract breaks and solving-state tracking
    ///     silently stops working across lock/unlock cycles.
    /// </summary>
    public override bool Locked
    {
        get => base.Locked;
        set
        {
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
        pManager.AddTextParameter("URL", "URL",
            "Web UI URL for this session (empty until the servers are running)", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        // Headless (Rhino.Compute): output the embedded schema and stop, no services/background tasks.
        if (HeadlessGuard.IsHeadless)
        {
            DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
            return;
        }

        var enable = false;
        DA.GetData(0, ref enable);

        InitializeDependencies();

        var document = OnPingDocument();
        if (!DocumentGuards.IsValid(document, out var error))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, error);
            DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
            return;
        }

        // Re-emitted every solve: runtime messages are cleared at the start of each one, so a
        // single warning at placement time would vanish on the next solve.
        if (_isRedundantPlacement)
        {
            if (HasOtherBridge(document))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "Another UI Bridge is already on this canvas. Each one runs its own server, " +
                    "session and schema, so the web UI may connect to the other component. Use a " +
                    "single UI Bridge per definition unless you intend two independent UIs.");
            }
            else
            {
                _isRedundantPlacement = false;
            }
        }

        var transition = _service.StateManager.ProcessEnableInput(enable);

        if (transition.EnableFalling)
        {
            HandleDisablingState(document);
        }

        // Rebind is needed on the rising edge (off→on), when the document changed under us, or when
        // subscriptions were torn down without a falling edge: right-click lock → unlock never solves
        // with enable=false, so EnableRising alone would skip the rebind and leave SolutionStart/End
        // dead, wedging IsBusy after the first value update.
        var rebind = enable && (transition.EnableRising
                                || _currentDocument != document
                                || !_service.EventManager.IsRegistered);
        if (rebind)
        {
            _currentDocument = document;
            _service.EventManager.RegisterEvents(document);
        }

        // Handle current state
        if (enable)
        {
            HandleEnabledState(DA, document, rebind);
        }
        else
        {
            HandleDisabledState(DA, document);
        }
    }

    private void InitializeDependencies()
    {
        if (_service != null)
        {
            return;
        }

        // Always a new session ID, never restored from file.
        _sessionId = new SessionManager().CreateNewSession();
        _service = new UIBuilderService(_sessionId, PluginVersion);

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

        _service.DocumentSyncService.OnParameterDeletionRequired += HandleParameterDeletion;

        // Keep watched set in sync when new params are merged into the schema
        _service.DocumentSyncService.OnNewIdsDiscovered += ids =>
            _service.EventManager.RegisterWatchedIds(ids);

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

            // Drain pending values on a fresh UI tick, not inline: draining here would re-schedule
            // a solve from inside the end of this one — under a slider drag that's a non-draining
            // loop. By the time the posted callback runs, IsBusy is false and the drain is safe.
            if (_service.StateManager.HasPendingValues)
            {
                RhinoApp.InvokeOnUiThread((Action)(() => _service.BridgeService?.DrainPendingValues()));
            }
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


    private void HandleEnabledState(IGH_DataAccess DA, GH_Document document, bool rebind)
    {
        var wasRunning = _service.ServerManager.IsRunning;

        // Also route through StartServersAsync on a rebind even if servers look up already:
        // it records the "should be running" intent, so a stop still in flight from a fast
        // disable→enable is skipped instead of landing after this solve and stranding dead servers.
        if (!wasRunning || rebind)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    var started = await _service.ServerManager.StartServersAsync(_sessionId);

                    // Only post the URL remark on an actual cold start, not a no-op re-confirm.
                    if (started && !wasRunning && _service.ServerManager.HttpPort.HasValue)
                    {
                        var wsPort = _service.ServerManager.WebSocketPort ?? AppConfig.WebSocket.DefaultPort;
                        var httpPort = _service.ServerManager.HttpPort.Value;
                        RhinoApp.InvokeOnUiThread(new Action(() =>
                        {
                            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                                $"Web UI available at: http://localhost:{httpPort}/?session={_sessionId}&wsPort={wsPort}");
                        }));
                    }

                    // Refresh once after a cold start so the URL output picks up the live ports.
                    if (started && !wasRunning)
                    {
                        RhinoApp.InvokeOnUiThread(new Action(() =>
                            GHDocumentMutator.ScheduleComponentExpire(document, this, true)));
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
        }

        if (!wasRunning)
        {
            Message = ComponentMessageFormatter.CreateDisplayMessage(true, true, _embeddedSchema, _sessionId);
        }

        if (_embeddedSchema != null && rebind)
        {
            // Drop params deleted, and reconcile nicknames renamed, while the component was off.
            _embeddedSchema = _service.SchemaSynchronizer.ValidateSchema(_embeddedSchema, document);
            _service.SchemaSynchronizer.SyncNicknamesFromDocument(_embeddedSchema, document);
            // Seed the watched set so UndoStateChanged can short-circuit correctly.
            _service.EventManager.RegisterWatchedObjects(_embeddedSchema);
        }

        DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
        SetUrlOutput(DA);
    }

    /// <summary>Null while the WebSocket transport isn't running yet.</summary>
    private string TryBuildSessionUrl()
    {
        if (_service?.WebSocketTransport?.IsRunning != true)
        {
            return null;
        }

        var wsPort = _service.WebSocketTransport.WebSocketPort;
        var baseUrl = _service.WebServer?.IsRunning == true
            ? _service.WebServer.BaseUrl
            : "http://localhost:5173";
        return $"{baseUrl}/?session={_sessionId}&wsPort={wsPort}";
    }

    /// <summary>Skipped when absent — the obsolete subclass registers only the Schema output.</summary>
    private void SetUrlOutput(IGH_DataAccess DA)
    {
        if (Params.Output.Count > 1)
        {
            DA.SetData(1, TryBuildSessionUrl());
        }
    }

    /// <summary>Called on the new instance during a component upgrade; `other` is the old one.</summary>
    internal void TransferStateFrom(GH_UIBuilderComponent other)
    {
        _embeddedSchema = other._embeddedSchema;
        _embeddedValues = other._embeddedValues;
    }

    private void HandleDisablingState(GH_Document document)
    {
        CleanupCommunication();
        _service?.EventManager?.UnregisterEvents();

        var contextualParams = document.Objects.OfType<IGH_ContextualParameter>().ToList();
        ParameterTypeHelper.ClearContextualParameters(contextualParams, this);
        _service?.ValueApplicator?.Clear();
    }

    private void HandleDisabledState(IGH_DataAccess DA, GH_Document document)
    {
        DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
        Message = ComponentMessageFormatter.CreateDisplayMessage(false, false, _embeddedSchema, _sessionId);
    }

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
            var url = TryBuildSessionUrl()
                      ?? $"http://localhost:5173/?session={_sessionId}&wsPort={AppConfig.WebSocket.DefaultPort}";

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

    /// <summary>
    ///     Set while an upgrader swaps an old component for a new one. GH_UpgradeUtil adds the
    ///     replacement to the document (firing <see cref="AddedToDocument" />) BEFORE migrating the
    ///     old component's sources and recipients onto it, so at that moment the new instance looks
    ///     like a fresh drop — zero sources, zero recipients — and would auto-wire a second toggle
    ///     next to the one already connected to Enable. Upgraders wrap the swap in
    ///     <see cref="SuppressAutoWire" /> to skip auto-wiring for that window.
    /// </summary>
    [ThreadStatic] private static bool _autoWireSuppressed;

    /// <summary>
    ///     Set when this component was dropped onto a canvas that already had a UI Bridge. Each one
    ///     runs its own WebSocket server, session and schema, so a second is usually a mistake —
    ///     but a legitimate one, so it warns rather than refuses. Deliberately not persisted: it
    ///     describes the placement, and on reload every bridge is equally "already there".
    /// </summary>
    private bool _isRedundantPlacement;

    /// <summary>
    ///     Also how a scripted build places a bare UI Bridge — without it, placement adds a Boolean
    ///     Toggle and a Context Bake alongside.
    ///
    ///     <see cref="ThreadStaticAttribute" />: the scope only covers placements on the calling
    ///     thread — add the component inside the using block, on the Grasshopper thread.
    /// </summary>
    public static IDisposable SuppressAutoWire()
    {
        return new AutoWireSuppression();
    }

    private sealed class AutoWireSuppression : IDisposable
    {
        private readonly bool _previous;

        public AutoWireSuppression()
        {
            _previous = _autoWireSuppressed;
            _autoWireSuppressed = true;
        }

        public void Dispose()
        {
            _autoWireSuppressed = _previous;
        }
    }

    public override void AddedToDocument(GH_Document document)
    {
        base.AddedToDocument(document);

        if (document == null || _autoWireSuppressed || !IsFreshPlacement())
        {
            return;
        }

        // Only the bridge just dropped on the canvas carries the warning — the one already running
        // is working fine and shouldn't start complaining because a second appeared.
        _isRedundantPlacement = HasOtherBridge(document);

        try
        {
            WireDefaultNeighbors(document);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Auto-wire on placement failed: {ex.Message}");
        }
    }

    private bool HasOtherBridge(GH_Document document)
    {
        return document.Objects.Any(o => o is GH_UIBuilderComponent && o.InstanceGuid != InstanceGuid);
    }

    /// <summary>False on file load, paste, or when the user has already wired/loaded state.</summary>
    private bool IsFreshPlacement()
    {
        if (_embeddedSchema != null)
        {
            return false;
        }

        if (HasEnableSource() || HasSchemaRecipient())
        {
            return false;
        }

        return true;
    }

    private bool HasEnableSource()
    {
        return Params.Input.Count > 0 && Params.Input[0].SourceCount > 0;
    }

    private bool HasSchemaRecipient()
    {
        return Params.Output.Count > 0 && Params.Output[0].Recipients.Count > 0;
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

        // Each side is wired independently: an already-connected Enable must not get a second toggle
        // even if the Schema output is still free (and vice versa).
        var toggle = HasEnableSource()
            ? null
            : Grasshopper.Instances.ComponentServer.EmitObject(BooleanToggleGuid) as IGH_Param;
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

        var bake = HasSchemaRecipient()
            ? null
            : Grasshopper.Instances.ComponentServer.EmitObject(HopsContextBakeGuid);
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

    private void ClearAllContextualParameters()
    {
        var document = OnPingDocument();
        if (document == null)
        {
            return;
        }

        try
        {
            foreach (var obj in document.Objects)
            {
                if (obj is IGH_ContextualParameter contextParam)
                {
                    ParameterTypeHelper.TryInvokeClearContextualData(contextParam);
                    continue;
                }

                if (ParameterTypeHelper.IsContextOutputComponent(obj) ||
                    ParameterTypeHelper.IsContextBakeComponent(obj))
                {
                    ParameterTypeHelper.TryInvokeClearContextualData(obj);
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error clearing contextual data: {ex.Message}");
        }
    }

    private void CleanupCommunication()
    {
        if (_service?.ServerManager != null)
        {
            try
            {
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

    public override bool Write(GH_IWriter writer)
    {
        // Don't depend on _service being initialized — under headless hosts (or before the first
        // solve) it is null, and skipping serialization there would silently drop the saved schema.
        try
        {
            var persistence = _service?.PersistenceService ?? new SchemaArchiveSerializer(PluginVersion);
            var lastValues = _service?.ValueApplicator?.GetLastAppliedValues();
            persistence.SerializeToArchive(writer, _embeddedSchema, lastValues);
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Could not save schema/values: {ex.Message}");
        }

        // Skip under headless hosts like Rhino.Compute, which never legitimately save back.
        if (_embeddedSchema != null && !HeadlessGuard.IsHeadless)
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

                    if (!string.IsNullOrEmpty(result.Value.migrationMessage))
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, result.Value.migrationMessage);
                    }
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
