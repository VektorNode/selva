using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper;
using Grasshopper.Kernel;
using Rhino;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Manages Grasshopper document event subscriptions and handling.
/// </summary>
public class DocumentEventManager : IDisposable
{
    private const int DOCUMENT_MODIFIED_DEBOUNCE_MS = 600;
    private readonly WebSocketTransport _webSocketTransport;
    private readonly SchemaSynchronizer _schemaSynchronizer;
    private readonly ValueCollector _valueCollector;

    // GUIDs of relevant objects (contextual params + output components), so UndoStateChanged
    // can short-circuit when none exist. Populated via RegisterWatchedObjects on enable, kept
    // current in OnObjectsAdded/Deleted.
    private readonly HashSet<Guid> _watchedIds = [];

    private GH_Document _currentDocument;
    private bool _disposed;

    /// <summary>
    ///     Whether document-side subscriptions are currently attached. The component uses this to
    ///     detect teardowns that happen without an enable falling edge (right-click lock → unlock
    ///     never re-solves with enable=false, so edge detection alone misses the re-registration).
    /// </summary>
    public bool IsRegistered => _eventsRegistered;

    private Timer _documentModifiedTimer;
    private bool _eventsRegistered;

    public DocumentEventManager(SchemaSynchronizer schemaSynchronizer, ValueCollector valueCollector,
        WebSocketTransport webSocketTransport)
    {
        _schemaSynchronizer = schemaSynchronizer ?? throw new ArgumentNullException(nameof(schemaSynchronizer));
        _valueCollector = valueCollector ?? throw new ArgumentNullException(nameof(valueCollector));
        _webSocketTransport = webSocketTransport ?? throw new ArgumentNullException(nameof(webSocketTransport));
        // Timer callback fires on a ThreadPool thread. Marshal to the Rhino UI thread before
        // raising DocumentModified — downstream handlers read GH document state (FindObject,
        // Params, VolatileData) which is not safe to touch off the UI thread.
        _documentModifiedTimer = new Timer(
            _ => RhinoApp.InvokeOnUiThread(new Action(() =>
                DocumentModified?.Invoke(this, EventArgs.Empty))),
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

    public event EventHandler SolutionStarted;
    public event EventHandler SolutionEnded;
    public event EventHandler<ParametersChangedEventArgs> ParametersChanged;
    public event EventHandler<MetadataChangedEventArgs> MetadataChanged;
    public event EventHandler DocumentModified;

    /// <summary>
    ///     Seed the watched set from the current schema. Call on EnableRising.
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
    ///     Add IDs to the watched set when new params are merged into the schema.
    /// </summary>
    public void RegisterWatchedIds(IEnumerable<Guid> ids)
    {
        foreach (var id in ids)
        {
            _watchedIds.Add(id);
        }
    }

    public void ClearWatchedObjects()
    {
        _watchedIds.Clear();
    }

    public void RegisterEvents(GH_Document document)
    {
        if (document == null)
        {
            return;
        }

        if (_currentDocument != null && _currentDocument.DocumentID != document.DocumentID)
        {
            UnregisterEvents();
        }

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
    ///     Unregisters document-side subscriptions only. The public events (SolutionStarted,
    ///     DocumentModified, etc.) stay wired — they're owned by component-side subscribers that
    ///     bind once per component lifetime and unwire in the component's Cleanup()/Dispose().
    ///     See GH_UIBuilderComponent.Locked for the matching note.
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

        if (_webSocketTransport.IsRunning)
            // Fire-and-forget: informational only.
        {
            _ = _webSocketTransport.BroadcastSolvingState(true);
        }
    }

    private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
        SolutionEnded?.Invoke(this, EventArgs.Empty);

        if (!_webSocketTransport.IsRunning)
        {
            return;
        }

        // BroadcastSolvingState is non-blocking (returns the in-flight Task) and deduplicates
        // internally — no Task.Run wrapper needed. If a send fails, observe the fault and log,
        // but don't crash the GH event thread.
        _ = _webSocketTransport.BroadcastSolvingState(false).ContinueWith(t =>
        {
            if (t.IsFaulted)
            {
                Logger.Warn($"[DocumentEventManager] Failed to broadcast solving=false: {t.Exception?.GetBaseException().Message}");
            }
        }, TaskContinuationOptions.OnlyOnFaulted);
    }

    /// <summary>
    ///     Trailing-edge debounced — fires 600ms after the last event, so a full rename is
    ///     captured before metadata detection runs.
    /// </summary>
    private void OnUndoStateChanged(object sender, GH_DocUndoEventArgs e)
    {
        if (_currentDocument == null || !_webSocketTransport.IsRunning)
        {
            return;
        }

        if (_watchedIds.Count == 0)
        {
            return;
        }

        _documentModifiedTimer?.Change(DOCUMENT_MODIFIED_DEBOUNCE_MS, Timeout.Infinite);
    }

    private void OnObjectsAdded(object sender, GH_DocObjectEventArgs e)
    {
        if (_currentDocument == null || !_webSocketTransport.IsRunning)
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
    ///     Uses the watched set for O(1) membership — no need to re-run type predicates on
    ///     every deleted object.
    /// </summary>
    private void OnObjectsDeleted(object sender, GH_DocObjectEventArgs e)
    {
        if (_currentDocument == null || !_webSocketTransport.IsRunning)
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

    public void DetectAndBroadcastMetadataChanges(UISchema schema)
    {
        if (_currentDocument == null || !_webSocketTransport.IsRunning || schema == null)
        {
            return;
        }

        try
        {
            var metadataChanges = _schemaSynchronizer.DetectMetadataChanges(_currentDocument, schema);
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
                var _ = _webSocketTransport.BroadcastMetadataChanges(metadataChanges);
                MetadataChanged?.Invoke(this, new MetadataChangedEventArgs { Changes = metadataChanges });
            }
        }
        catch (Exception ex)
        {
            _ = ex; // referenced only by the DEBUG log below
#if DEBUG
            Logger.Error("[UIBuilder] DetectAndBroadcastMetadataChanges failed", ex);
#endif
        }
    }

    /// <summary>
    ///     Returns true when a payload actually went out. A false means the ContextBakes held no
    ///     volatile data — the caller may need to expire them to regenerate it.
    /// </summary>
    public bool CollectAndBroadcastOutputs(UISchema schema)
    {
        if (_currentDocument == null || !_webSocketTransport.IsRunning || schema == null)
        {
            return false;
        }

        var includeDisplayData = schema.ViewerOptions?.EnableLocal ?? false;

        var outputValues = _valueCollector.CollectOutputValues(_currentDocument, schema);
        var fileOutputs = _valueCollector.CollectFileOutputs(_currentDocument, schema);
        // Only scan display data when the 3D viewer is enabled — otherwise wasted work.
        //
        // This re-scans the whole document for ContextBakes instead of trusting _watchedIds:
        // that set misses ContextBakes added while the WS server was down (OnObjectsAdded
        // early-returns on !IsRunning), or restored by undo/redo/paste without a reliable
        // ObjectsAdded event. Skipping the full scan would silently drop those components'
        // meshes from the frontend. A full scan is O(objects) once per solve-end and catches
        // all of them.
        var displayData = includeDisplayData
            ? _valueCollector.CollectDisplayData(_currentDocument)
            : new List<object>();

        if (outputValues.Count == 0 && fileOutputs.Count == 0 && displayData.Count == 0)
        {
            return false;
        }

        var _ = _webSocketTransport.BroadcastOutputsWithFilesAndDisplay(outputValues, fileOutputs, displayData,
            includeDisplayData);
        return true;
    }
}

public class ParametersChangedEventArgs : EventArgs
{
    public GH_Document Document { get; set; }
}

public class MetadataChangedEventArgs : EventArgs
{
    public DiscoveredParameters Changes { get; set; }
}
