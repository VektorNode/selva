using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper;
using Grasshopper.Kernel;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Features.UIBuilder.Services.Values;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Events;

/// <summary>
///     Manages Grasshopper document event subscriptions and handling
/// </summary>
public class DocumentEventManager : IDisposable
{
    private const int DOCUMENT_MODIFIED_DEBOUNCE_MS = 600;
    private readonly CommunicationHandler _communicationHandler;
    private readonly SchemaManager _schemaManager;
    private readonly ValueCollector _valueCollector;

    // Watched set — GUIDs of relevant objects (contextual params + output components).
    // Populated via RegisterWatchedObjects on enable; updated incrementally in OnObjectsAdded/Deleted.
    // Used to short-circuit UndoStateChanged when no relevant objects exist.
    private readonly HashSet<Guid> _watchedIds = [];

    private GH_Document _currentDocument;
    private bool _disposed;

    // Trailing-edge debounce timer for UndoStateChanged — fires 600ms after the last event.
    private Timer _documentModifiedTimer;
    private bool _eventsRegistered;

    public DocumentEventManager(SchemaManager schemaManager, ValueCollector valueCollector,
        CommunicationHandler communicationHandler)
    {
        _schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
        _valueCollector = valueCollector ?? throw new ArgumentNullException(nameof(valueCollector));
        _communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
        _documentModifiedTimer = new Timer(
            _ => DocumentModified?.Invoke(this, EventArgs.Empty),
            null,
            Timeout.Infinite,
            Timeout.Infinite);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        UnregisterEvents();
        _documentModifiedTimer?.Dispose();
        _documentModifiedTimer = null;
        _currentDocument = null;
        _disposed = true;
    }

    // Events for component to subscribe to
    public event EventHandler SolutionStarted;
    public event EventHandler SolutionEnded;
    public event EventHandler<ParametersChangedEventArgs> ParametersChanged;
    public event EventHandler<MetadataChangedEventArgs> MetadataChanged;
    public event EventHandler DocumentModified;

    /// <summary>
    ///     Seed the watched set from the current schema. Call on EnableRising so that
    ///     UndoStateChanged can short-circuit immediately when no relevant objects exist.
    /// </summary>
    public void RegisterWatchedObjects(UISchema schema)
    {
        if (schema == null)
        {
            return;
        }

        foreach (var input in schema.Inputs)
        {
            _watchedIds.Add(input.Id);
        }

        foreach (var output in schema.Outputs)
        {
            _watchedIds.Add(output.Id);
        }
    }

    /// <summary>
    ///     Add individual IDs to the watched set — called when new params are merged into the schema.
    /// </summary>
    public void RegisterWatchedIds(IEnumerable<Guid> ids)
    {
        foreach (var id in ids)
        {
            _watchedIds.Add(id);
        }
    }

    /// <summary>
    ///     Clear the watched set. Called from UnregisterEvents on disable/document switch.
    /// </summary>
    public void ClearWatchedObjects()
    {
        _watchedIds.Clear();
    }

    /// <summary>
    ///     Register events for a document
    /// </summary>
    public void RegisterEvents(GH_Document document)
    {
        if (document == null)
        {
            return;
        }

        // Unregister from previous document if switching documents
        if (_currentDocument != null && _currentDocument.DocumentID != document.DocumentID)
        {
            UnregisterEvents();
        }

        // Early return if already registered for THIS document
        if (_eventsRegistered && _currentDocument != null && _currentDocument.DocumentID == document.DocumentID)
        {
            return;
        }

        _currentDocument = document;

        try
        {
            Instances.DocumentServer.DocumentRemoved += OnDocumentRemoved;
        }
        catch (Exception ex)
        {
            Logger.Error("Failed to subscribe to DocumentRemoved event", ex);
        }

        try
        {
            _currentDocument.SolutionStart += OnSolutionStart;
            _currentDocument.SolutionEnd += OnSolutionEnd;
            _currentDocument.ObjectsAdded += OnObjectsAdded;
            _currentDocument.ObjectsDeleted += OnObjectsDeleted;
            _currentDocument.UndoStateChanged += OnUndoStateChanged;
        }
        catch (Exception ex)
        {
            Logger.Error("Failed to subscribe to document events", ex);
        }

        _eventsRegistered = true;
    }

    /// <summary>
    ///     Unregister all events
    /// </summary>
    public void UnregisterEvents()
    {
        if (!_eventsRegistered)
        {
            return;
        }

        try
        {
            Instances.DocumentServer.DocumentRemoved -= OnDocumentRemoved;
        }
        catch (Exception ex)
        {
            Logger.Warn($"Failed to unsubscribe from DocumentRemoved event: {ex.Message}");
        }

        if (_currentDocument != null)
        {
            try
            {
                _currentDocument.SolutionStart -= OnSolutionStart;
                _currentDocument.SolutionEnd -= OnSolutionEnd;
                _currentDocument.ObjectsAdded -= OnObjectsAdded;
                _currentDocument.ObjectsDeleted -= OnObjectsDeleted;
                _currentDocument.UndoStateChanged -= OnUndoStateChanged;
            }
            catch (Exception ex)
            {
                Logger.Warn($"Failed to unsubscribe from document events: {ex.Message}");
            }
        }

        ClearWatchedObjects();
        _eventsRegistered = false;
    }

    private void OnDocumentRemoved(GH_DocumentServer sender, GH_Document doc)
    {
        if (_currentDocument != null && doc != null && doc.DocumentID == _currentDocument.DocumentID)
        {
            UnregisterEvents();
            _currentDocument = null;
        }
    }

    private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
    {
        SolutionStarted?.Invoke(this, EventArgs.Empty);

        if (_communicationHandler.IsRunning)
            // Fire and forget is ok for start message - it's informational
            // Note: SetSolving now returns false if debounced, so we always broadcast to be safe
        {
            _ = _communicationHandler.BroadcastSolvingState(true);
        }
    }

    private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
        SolutionEnded?.Invoke(this, EventArgs.Empty);

        if (_communicationHandler.IsRunning)
            // Critical: Ensure solving=false is sent. If this fails, clients may get stuck.
            // We use Task.Run to avoid blocking Grasshopper's event thread
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _communicationHandler.BroadcastSolvingState(false);
                }
                catch (Exception ex)
                {
                    Logger.Warn($"[DocumentEventManager] Failed to broadcast solving=false: {ex.Message}");
                    // Even if broadcast fails, state should eventually timeout on client side
                }
            });
        }
    }

    /// <summary>
    ///     Handle undo/redo state changes. Trailing-edge debounced — fires 600ms after
    ///     the last event, so a full rename is captured before metadata detection runs.
    ///     Gated on the watched set: if no relevant objects exist, returns at zero cost.
    /// </summary>
    private void OnUndoStateChanged(object sender, GH_DocUndoEventArgs e)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning)
        {
            return;
        }

        if (_watchedIds.Count == 0)
        {
            return;
        }

        // Reset the timer on every event — fires only after 600ms of silence
        _documentModifiedTimer?.Change(DOCUMENT_MODIFIED_DEBOUNCE_MS, Timeout.Infinite);
    }


    /// <summary>
    ///     Handle objects added to the document. Only fires ParametersChanged if a relevant
    ///     object (contextual param or output component) was added, and adds it to the watched set.
    /// </summary>
    private void OnObjectsAdded(object sender, GH_DocObjectEventArgs e)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning)
        {
            return;
        }

        var anyAdded = false;
        foreach (var obj in e.Objects)
        {
            if (obj is IGH_DocumentObject docObj && IsRelevantObject(obj))
            {
                _watchedIds.Add(docObj.InstanceGuid);
                anyAdded = true;
            }
        }

        if (anyAdded)
        {
            ParametersChanged?.Invoke(this, new ParametersChangedEventArgs { Document = _currentDocument });
        }
    }

    /// <summary>
    ///     Handle objects deleted from the document. Uses the watched set for O(1) membership
    ///     check — no need to re-run type predicates on every deleted object.
    /// </summary>
    private void OnObjectsDeleted(object sender, GH_DocObjectEventArgs e)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning)
        {
            return;
        }

        var anyRemoved = false;
        foreach (var obj in e.Objects)
        {
            if (obj is IGH_DocumentObject docObj && _watchedIds.Remove(docObj.InstanceGuid))
            {
                anyRemoved = true;
            }
        }

        if (anyRemoved)
        {
            ParametersChanged?.Invoke(this, new ParametersChangedEventArgs { Document = _currentDocument });
        }
    }

    private static bool IsRelevantObject(IGH_DocumentObject obj)
    {
        return obj is IGH_ContextualParameter
               || ParameterTypeHelper.IsContextOutputComponent(obj)
               || ParameterTypeHelper.IsContextBakeComponent(obj);
    }

    /// <summary>
    ///     Notify that metadata should be detected and broadcast
    /// </summary>
    public void DetectAndBroadcastMetadataChanges(UISchema schema)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning || schema == null)
        {
            return;
        }

        try
        {
            var metadataChanges = _schemaManager.DetectMetadataChanges(_currentDocument, schema);
#if DEBUG
            Logger.Log(
                $"[UIBuilder] MetadataDetect — changed inputs={metadataChanges.Inputs.Count}, outputs={metadataChanges.Outputs.Count}");
#endif
            if (metadataChanges.Inputs.Count > 0 || metadataChanges.Outputs.Count > 0)
            {
#if DEBUG
                var names = metadataChanges.Inputs.Select(i => i.Nickname)
                    .Concat(metadataChanges.Outputs.Select(o => o.Nickname));
                Logger.Log($"[UIBuilder] MetadataChanged — params=[{string.Join(", ", names)}]");
#endif
                var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);
                MetadataChanged?.Invoke(this, new MetadataChangedEventArgs { Changes = metadataChanges });
            }
        }
        catch (Exception ex)
        {
#if DEBUG
            Logger.Error("[UIBuilder] DetectAndBroadcastMetadataChanges failed", ex);
#endif
        }
    }

    /// <summary>
    ///     Collect and broadcast outputs to connected clients
    /// </summary>
    public void CollectAndBroadcastOutputs(UISchema schema)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning || schema == null)
        {
            return;
        }

        var includeDisplayData = schema.ViewerOptions?.EnableLocal ?? false;

        var outputValues = _valueCollector.CollectOutputValues(_currentDocument, schema);
        var fileOutputs = _valueCollector.CollectFileOutputs(_currentDocument, schema);
        // Only scan display data when the 3D viewer is enabled — scanning all document objects is expensive
        var displayData =
            includeDisplayData ? _valueCollector.CollectDisplayData(_currentDocument) : new List<object>();

        if (outputValues.Count > 0 || fileOutputs.Count > 0 || displayData.Count > 0)
        {
            var _ = _communicationHandler.BroadcastOutputsWithFilesAndDisplay(outputValues, fileOutputs, displayData,
                includeDisplayData);
        }
    }
}

/// <summary>
///     Event args for parameter changes
/// </summary>
public class ParametersChangedEventArgs : EventArgs
{
    public GH_Document Document { get; set; }
}

/// <summary>
///     Event args for metadata changes
/// </summary>
public class MetadataChangedEventArgs : EventArgs
{
    public DiscoveredParameters Changes { get; set; }
}
