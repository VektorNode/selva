using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper;
using Grasshopper.Kernel;
using Selva.Core.Models;
using Selva.GH.Features.ComputeIO.Components;
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
    private const int OUTPUT_BROADCAST_DEBOUNCE_MS = 100;
    private readonly CommunicationHandler _communicationHandler;
    private readonly SchemaManager _schemaManager;
    private readonly ValueCollector _valueCollector;

    private GH_Document _currentDocument;
    private bool _disposed;
    private bool _eventsRegistered;

    // Debounce output broadcasts to prevent duplicate sends
    private DateTime _lastOutputBroadcast = DateTime.MinValue;

    public DocumentEventManager(SchemaManager schemaManager, ValueCollector valueCollector,
        CommunicationHandler communicationHandler)
    {
        _schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
        _valueCollector = valueCollector ?? throw new ArgumentNullException(nameof(valueCollector));
        _communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
    }

    public void Dispose()
    {
        if (_disposed) return;

        UnregisterEvents();
        _currentDocument = null;
        _disposed = true;
    }

    // Events for component to subscribe to
    public event EventHandler SolutionStarted;
    public event EventHandler SolutionEnded;
    public event EventHandler<ParametersChangedEventArgs> ParametersChanged;
    public event EventHandler<MetadataChangedEventArgs> MetadataChanged;

    /// <summary>
    ///     Register events for a document
    /// </summary>
    public void RegisterEvents(GH_Document document)
    {
        if (document == null) return;

        // Unregister from previous document if switching documents
        if (_currentDocument != null && _currentDocument.DocumentID != document.DocumentID) UnregisterEvents();

        // Early return if already registered for THIS document
        if (_eventsRegistered && _currentDocument != null && _currentDocument.DocumentID == document.DocumentID) return;

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
            _currentDocument.ObjectsAdded += OnObjectsChanged;
            _currentDocument.ObjectsDeleted += OnObjectsChanged;
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
        if (!_eventsRegistered) return;

        try
        {
            Instances.DocumentServer.DocumentRemoved -= OnDocumentRemoved;
        }
        catch (Exception ex)
        {
            Logger.Warn($"Failed to unsubscribe from DocumentRemoved event: {ex.Message}");
        }

        if (_currentDocument != null)
            try
            {
                _currentDocument.SolutionStart -= OnSolutionStart;
                _currentDocument.SolutionEnd -= OnSolutionEnd;
                _currentDocument.ObjectsAdded -= OnObjectsChanged;
                _currentDocument.ObjectsDeleted -= OnObjectsChanged;
                _currentDocument.UndoStateChanged -= OnUndoStateChanged;
            }
            catch (Exception ex)
            {
                Logger.Warn($"Failed to unsubscribe from document events: {ex.Message}");
            }

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
            _ = _communicationHandler.BroadcastSolvingState(true);
    }

    private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
        SolutionEnded?.Invoke(this, EventArgs.Empty);

        if (_communicationHandler.IsRunning)
            // Critical: Ensure solving=false is sent. If this fails, clients may get stuck.
            // We use Task.Run to avoid blocking Grasshopper's event thread
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

    /// <summary>
    ///     Handle undo/redo state changes.
    ///     Metadata detection is handled by the SolutionEnded path, which fires after undo triggers a re-solve.
    /// </summary>
    private void OnUndoStateChanged(object sender, GH_DocUndoEventArgs e)
    {
        // No direct action needed: undo/redo triggers a new GH solution,
        // which fires SolutionEnded → DetectAndBroadcastMetadataChanges naturally.
    }

    /// <summary>
    ///     Handle objects added or deleted in document
    /// </summary>
    private void OnObjectsChanged(object sender, GH_DocObjectEventArgs e)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning) return;

        // Check if any changed objects are contextual parameters or output components
        var relevantChange = false;
        foreach (var obj in e.Objects)
            if (obj is IGH_ContextualParameter ||
                ParameterTypeHelper.IsContextOutputComponent(obj) ||
                ParameterTypeHelper.IsContextBakeComponent(obj))
            {
                relevantChange = true;
                break;
            }

        if (!relevantChange) return;

        // Notify component that parameters changed
        ParametersChanged?.Invoke(this, new ParametersChangedEventArgs
        {
            Document = _currentDocument
        });
    }

    /// <summary>
    ///     Notify that metadata should be detected and broadcast
    /// </summary>
    public void DetectAndBroadcastMetadataChanges(UISchema schema)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning || schema == null) return;

        try
        {
            var metadataChanges = _schemaManager.DetectMetadataChanges(_currentDocument, schema);
#if DEBUG
			Logger.Log($"[UIBuilder] MetadataDetect — changed inputs={metadataChanges.Inputs.Count}, outputs={metadataChanges.Outputs.Count}");
#endif
            if (metadataChanges.Inputs.Count > 0 || metadataChanges.Outputs.Count > 0)
            {
                var requiresRecalc = ShouldRecalculateAfterMetadataChange(metadataChanges);
#if DEBUG
				var names = metadataChanges.Inputs.Select(i => i.Nickname)
					.Concat(metadataChanges.Outputs.Select(o => o.Nickname));
				Logger.Log($"[UIBuilder] MetadataChanged — params=[{string.Join(", ", names)}], requiresRecalc={requiresRecalc}");
#endif
                var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);
                MetadataChanged?.Invoke(this, new MetadataChangedEventArgs
                {
                    Changes = metadataChanges,
                    RequiresRecalculation = requiresRecalc
                });
            }
        }
        catch
        {
            /* ignore */
        }
    }

    /// <summary>
    ///     Check if metadata changes require solution recalculation
    /// </summary>
    private bool ShouldRecalculateAfterMetadataChange(DiscoveredParameters changes)
    {
        // Check input changes
        var hasInputChanges = changes.Inputs.Any(change =>
        {
            var paramObj = _currentDocument.FindObject(change.Id, false);
            if (paramObj is GetValueListParameter && change.Options != null) return true; // ValueList options changed

            if (paramObj is IGH_ContextualParameter &&
                (change.Minimum != null || change.Maximum != null || change.StepSize != null))
                return true; // Number constraints changed

            return false;
        });

        // Output changes don't typically require recalculation
        return hasInputChanges;
    }

    /// <summary>
    ///     Collect and broadcast outputs to connected clients
    /// </summary>
    public void CollectAndBroadcastOutputs(UISchema schema)
    {
        if (_currentDocument == null || !_communicationHandler.IsRunning || schema == null) return;

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
    public bool RequiresRecalculation { get; set; }
}
