using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Selva.Core.Models;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Events;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Handles synchronization between Grasshopper document changes and UI schema state.
///     Subscribes to document events and coordinates schema validation, parameter updates, and broadcasts.
/// </summary>
public class DocumentSynchronizationService : IDisposable
{
    private readonly SchemaCleanupService _cleanupService;
    private readonly CommunicationHandler _communicationHandler;
    private readonly DocumentEventManager _eventManager;
    private readonly SchemaManager _schemaManager;

    private GH_Component _component;
    private GH_Document _currentDocument;
    private bool _disposed;

    // Callbacks to access component's schema/values (single source of truth)
    private Func<UISchema> _getSchema;
    private Func<Dictionary<string, object>> _getValues;
    private Action<UISchema> _setSchema;

    public DocumentSynchronizationService(
        DocumentEventManager eventManager,
        SchemaManager schemaManager,
        CommunicationHandler communicationHandler,
        SchemaCleanupService cleanupService)
    {
        _eventManager = eventManager ?? throw new ArgumentNullException(nameof(eventManager));
        _schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
        _communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
        _cleanupService = cleanupService ?? throw new ArgumentNullException(nameof(cleanupService));
    }

    public void Dispose()
    {
        if (_disposed) return;

        // Unwire event handlers
        if (_eventManager != null)
        {
            _eventManager.ParametersChanged -= HandleParametersChanged;
            _eventManager.MetadataChanged -= HandleMetadataChanged;
        }

        _disposed = true;
    }

    // Delegate for parameter deletion handling
    public event Action<List<Guid>, GH_Document> OnParameterDeletionRequired;

    // Delegate to register newly discovered IDs into the watched set
    public event Action<IEnumerable<Guid>> OnNewIdsDiscovered;

    /// <summary>
    ///     Initialize the service and wire up document event handlers.
    /// </summary>
    public void Initialize(
        GH_Component component,
        GH_Document document,
        Func<UISchema> getSchema,
        Func<Dictionary<string, object>> getValues,
        Action<UISchema> setSchema)
    {
        _component = component ?? throw new ArgumentNullException(nameof(component));
        _currentDocument = document;
        _getSchema = getSchema ?? throw new ArgumentNullException(nameof(getSchema));
        _getValues = getValues ?? throw new ArgumentNullException(nameof(getValues));
        _setSchema = setSchema ?? throw new ArgumentNullException(nameof(setSchema));

        // Wire up document event handlers
        _eventManager.ParametersChanged += HandleParametersChanged;
        _eventManager.MetadataChanged += HandleMetadataChanged;
    }

    private void HandleParametersChanged(object sender, ParametersChangedEventArgs e)
    {
        try
        {
            var schema = _getSchema();

            if (schema == null)
            {
                // No schema yet — broadcast available params as a hint so the UI can show them
                var available = GetCurrentAvailableParameters(e.Document);
                if (available.Inputs.Count > 0 || available.Outputs.Count > 0)
                {
                    _ = _communicationHandler
                        .BroadcastMessage("parametersAdded", new { availableParams = available })
                        .ContinueWith(t =>
                        {
                            if (t.IsFaulted) Logger.Error("Failed to broadcast parametersAdded", t.Exception);
                        });
                    _component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                        $"Parameter(s)/Output(s) detected: {available.Inputs.Count} params, {available.Outputs.Count} outputs. Check web UI.");
                }
                return;
            }

            // Snapshot IDs before validation so we can detect what was added vs removed
            var inputIdsBefore = new HashSet<Guid>(schema.Inputs.Select(i => i.Id));
            var outputIdsBefore = new HashSet<Guid>(schema.Outputs.Select(o => o.Id));

            // ValidateSchemaAndTrackChanges: purges deleted params AND merges new ones into schema.Inputs
            List<Guid> removedIds;
            (schema, removedIds) = _schemaManager.ValidateSchemaAndTrackChanges(schema, e.Document);
            _setSchema(schema);

            if (removedIds.Count > 0)
            {
                // Parameters deleted — cleanup, expire, done. New adds can't coexist with deletes in one event.
                OnParameterDeletionRequired?.Invoke(removedIds, e.Document);
                GHDocumentMutator.ScheduleComponentExpire(e.Document, _component);
                return;
            }

            // Check if MergeDiscoveredInputs added anything new
            var addedInputs = schema.Inputs.Where(i => !inputIdsBefore.Contains(i.Id)).ToList();
            var addedOutputs = schema.Outputs.Where(o => !outputIdsBefore.Contains(o.Id)).ToList();

            if (addedInputs.Count == 0 && addedOutputs.Count == 0) return;

            // Register the new IDs in the watched set immediately
            OnNewIdsDiscovered?.Invoke(addedInputs.Select(i => i.Id).Concat(addedOutputs.Select(o => o.Id)));

            // Broadcast the full updated schema — web UI updates without reload
            _ = _communicationHandler
                .BroadcastSchemaUpdate(schema)
                .ContinueWith(t =>
                {
                    if (t.IsFaulted) Logger.Error("Failed to broadcast schema update after param add", t.Exception);
                });

            // Expire UIBridge so downstream GH components (EvaluateSchema etc.) re-solve with updated schema
            GHDocumentMutator.ScheduleComponentExpire(e.Document, _component);

            _component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"New items added: {addedInputs.Count} param(s), {addedOutputs.Count} output(s).");
        }
        catch (Exception ex)
        {
            _component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error updating schema: {ex.Message}");
        }
    }

    private void HandleMetadataChanged(object sender, MetadataChangedEventArgs e)
    {
        try
        {
            if (e.Changes.Inputs.Count == 0 && e.Changes.Outputs.Count == 0) return;

            var document = _currentDocument ?? _component?.OnPingDocument();
            if (document == null) return;

            _currentDocument ??= document;
            document.Modified();

            // Schema already updated in memory — schedule a full expire so UIBridge re-solves
            // and downstream components (EvaluateSchema etc.) receive the updated schema.
            GHDocumentMutator.ScheduleComponentExpire(document, _component, immediate: true);
#if DEBUG
            Logger.Log($"[UIBuilder] MetadataChanged — scheduling full expire");
#endif
        }
        catch (Exception ex)
        {
            _component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error handling metadata changes: {ex.Message}");
        }
    }

    private DiscoveredParameters GetCurrentAvailableParameters(GH_Document document)
    {
        if (document == null || _component == null)
            return new DiscoveredParameters { SessionId = "", Inputs = [], Outputs = [] };

        return _schemaManager.ScanParameters(document, _component);
    }
}
