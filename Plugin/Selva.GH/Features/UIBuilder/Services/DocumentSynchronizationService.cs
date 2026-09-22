using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Communication;
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
    private readonly WebSocketTransport _webSocketTransport;
    private readonly DocumentEventManager _eventManager;
    private readonly SchemaSynchronizer _schemaSynchronizer;

    private GH_Component _component;
    private GH_Document _currentDocument;
    private bool _disposed;

    // Callbacks to access component's schema/values (single source of truth)
    private Func<UISchema> _getSchema;
    private Func<Dictionary<string, object>> _getValues;
    private Action<UISchema> _setSchema;

    public DocumentSynchronizationService(
        DocumentEventManager eventManager,
        SchemaSynchronizer schemaSynchronizer,
        WebSocketTransport webSocketTransport,
        SchemaCleanupService cleanupService)
    {
        _eventManager = eventManager ?? throw new ArgumentNullException(nameof(eventManager));
        _schemaSynchronizer = schemaSynchronizer ?? throw new ArgumentNullException(nameof(schemaSynchronizer));
        _webSocketTransport = webSocketTransport ?? throw new ArgumentNullException(nameof(webSocketTransport));
        _cleanupService = cleanupService ?? throw new ArgumentNullException(nameof(cleanupService));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        if (_eventManager != null)
        {
            _eventManager.ParametersChanged -= HandleParametersChanged;
            _eventManager.MetadataChanged -= HandleMetadataChanged;
        }

        _disposed = true;
    }

    public event Action<List<Guid>, GH_Document> OnParameterDeletionRequired;

    // Lets the watched set pick up IDs for newly-discovered params without a full re-scan.
    public event Action<IEnumerable<Guid>> OnNewIdsDiscovered;

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
                // No schema yet: broadcast available params as a hint so the UI can show them
                var available = GetCurrentAvailableParameters(e.Document);
                if (available.Inputs.Count > 0 || available.Outputs.Count > 0)
                {
                    _ = _webSocketTransport
                        .BroadcastParametersAdded(available)
                        .ContinueWith(t =>
                        {
                            if (t.IsFaulted)
                            {
                                Logger.Error("Failed to broadcast parametersAdded", t.Exception);
                            }
                        });
                    _component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                        $"Parameter(s)/Output(s) detected: {available.Inputs.Count} params, {available.Outputs.Count} outputs. Check web UI.");
                }

                return;
            }

            // Snapshot IDs before validation to detect what was added vs removed below.
            var inputIdsBefore = new HashSet<Guid>(schema.Inputs.Select(i => i.Id));
            var outputIdsBefore = new HashSet<Guid>(schema.Outputs.Select(o => o.Id));

            // Purges deleted params and merges newly-discovered ones into the schema.
            List<Guid> removedIds;
            (schema, removedIds) = _schemaSynchronizer.ValidateSchemaAndTrackChanges(schema, e.Document);
            _setSchema(schema);

            if (removedIds.Count > 0)
            {
                // Deletes and adds can't coexist in one event, so handle the delete and stop.
                OnParameterDeletionRequired?.Invoke(removedIds, e.Document);
                GHDocumentMutator.ScheduleComponentExpire(e.Document, _component);
                return;
            }

            var addedInputs = schema.Inputs.Where(i => !inputIdsBefore.Contains(i.Id)).ToList();
            var addedOutputs = schema.Outputs.Where(o => !outputIdsBefore.Contains(o.Id)).ToList();

            if (addedInputs.Count == 0 && addedOutputs.Count == 0)
            {
                return;
            }

            OnNewIdsDiscovered?.Invoke(addedInputs.Select(i => i.Id).Concat(addedOutputs.Select(o => o.Id)));

            _ = _webSocketTransport
                .BroadcastSchemaUpdate(schema)
                .ContinueWith(t =>
                {
                    if (t.IsFaulted)
                    {
                        Logger.Error("Failed to broadcast schema update after param add", t.Exception);
                    }
                });

            // Expire so downstream components (GH_EvaluateSchema etc.) re-solve with the updated schema.
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
            if (e.Changes.Inputs.Count == 0 && e.Changes.Outputs.Count == 0)
            {
                return;
            }

            var document = _currentDocument ?? _component?.OnPingDocument();
            if (document == null)
            {
                return;
            }

            _currentDocument ??= document;
            document.Modified();

            // Schema already updated in memory: full expire so this component and downstream
            // ones (GH_EvaluateSchema etc.) re-solve with it.
            GHDocumentMutator.ScheduleComponentExpire(document, _component, true);
#if DEBUG
            Logger.Log("[UIBuilder] MetadataChanged — scheduling full expire");
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
        {
            return new DiscoveredParameters { SessionId = "", Inputs = [], Outputs = [] };
        }

        return _schemaSynchronizer.ScanParameters(document, _component);
    }
}
