using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;
using Selva.Features.ComputeIO.Components;
using Selva.Features.UIBuilder.Helpers;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Manages Grasshopper document event subscriptions and handling
/// </summary>
public class DocumentEventManager : IDisposable
{
  private readonly CommunicationHandler _communicationHandler;
  private readonly SchemaManager _schemaManager;
  private readonly ValueCollector _valueCollector;

  private GH_Document _currentDocument;
  private bool _disposed;
  private bool _eventsRegistered;

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
  ///   Register events for a document
  /// </summary>
  public void RegisterEvents(GH_Document document)
  {
    if (document == null || _eventsRegistered) return;

    // Unregister from previous document if switching documents
    if (_currentDocument != null && _currentDocument.DocumentID != document.DocumentID) UnregisterEvents();

    _currentDocument = document;

    try
    {
      Instances.DocumentServer.DocumentRemoved += OnDocumentRemoved;
    }
    catch
    {
      /* ignore */
    }

    try
    {
      _currentDocument.SolutionStart += OnSolutionStart;
      _currentDocument.SolutionEnd += OnSolutionEnd;
      _currentDocument.ObjectsAdded += OnObjectsChanged;
      _currentDocument.ObjectsDeleted += OnObjectsChanged;
      _currentDocument.UndoStateChanged += OnUndoStateChanged;
    }
    catch
    {
      /* ignore */
    }

    _eventsRegistered = true;
  }

  /// <summary>
  ///   Unregister all events
  /// </summary>
  public void UnregisterEvents()
  {
    if (!_eventsRegistered) return;

    try
    {
      Instances.DocumentServer.DocumentRemoved -= OnDocumentRemoved;
    }
    catch
    {
      /* ignore */
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
      catch
      {
        /* ignore */
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
    {
      var _ = _communicationHandler.BroadcastSolvingState(true);
    }
  }

  private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
  {
    SolutionEnded?.Invoke(this, EventArgs.Empty);

    if (_communicationHandler.IsRunning)
    {
      var _ = _communicationHandler.BroadcastSolvingState(false);
    }
  }

  /// <summary>
  ///   Handle undo/redo state changes - detects property modifications
  /// </summary>
  private void OnUndoStateChanged(object sender, GH_DocUndoEventArgs e)
  {
    if (_currentDocument == null || !_communicationHandler.IsRunning) return;

    try
    {
      var metadataChanges = new List<AvailableParameter>();
      MetadataChanged?.Invoke(this, new MetadataChangedEventArgs { Changes = metadataChanges });

      if (metadataChanges.Count > 0)
      {
        var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);
      }
    }
    catch
    {
      /* ignore */
    }
  }

  /// <summary>
  ///   Handle objects added or deleted in document
  /// </summary>
  private void OnObjectsChanged(object sender, GH_DocObjectEventArgs e)
  {
    if (_currentDocument == null || !_communicationHandler.IsRunning) return;

    // Check if any changed objects are contextual parameters or output components
    var relevantChange = false;
    foreach (var obj in e.Objects)
    {
      if (obj is IGH_ContextualParameter ||
          ParameterTypeHelper.IsContextOutputComponent(obj) ||
          ParameterTypeHelper.IsContextBakeComponent(obj))
      {
        relevantChange = true;
        break;
      }
    }

    if (!relevantChange) return;

    // Notify component that parameters changed
    ParametersChanged?.Invoke(this, new ParametersChangedEventArgs
    {
      Document = _currentDocument
    });
  }

  /// <summary>
  ///   Notify that metadata should be detected and broadcast
  /// </summary>
  public void DetectAndBroadcastMetadataChanges(UISchema schema)
  {
    if (_currentDocument == null || !_communicationHandler.IsRunning || schema == null) return;

    try
    {
      var metadataChanges = _schemaManager.DetectMetadataChanges(_currentDocument, schema);
      if (metadataChanges.Count > 0)
      {
        var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);
        MetadataChanged?.Invoke(this, new MetadataChangedEventArgs
        {
          Changes = metadataChanges,
          RequiresRecalculation = ShouldRecalculateAfterMetadataChange(metadataChanges)
        });
      }
    }
    catch
    {
      /* ignore */
    }
  }

  /// <summary>
  ///   Check if metadata changes require solution recalculation
  /// </summary>
  private bool ShouldRecalculateAfterMetadataChange(List<AvailableParameter> changes)
  {
    return changes.Any(change =>
    {
      var paramObj = _currentDocument.FindObject(change.Id, false);
      if (paramObj is GetValueListParameter && change.Options != null) return true; // ValueList options changed

      if (paramObj is IGH_ContextualParameter &&
          (change.Minimum != null || change.Maximum != null || change.StepSize != null))
        return true; // Number constraints changed

      return false;
    });
  }

  /// <summary>
  ///   Collect and broadcast outputs to connected clients
  /// </summary>
  public void CollectAndBroadcastOutputs(UISchema schema)
  {
    if (_currentDocument == null || !_communicationHandler.IsRunning || schema == null) return;

    var outputValues = _valueCollector.CollectOutputValues(_currentDocument, schema);
    var fileOutputs = _valueCollector.CollectFileOutputs(_currentDocument, schema);

    if (outputValues.Count > 0 || fileOutputs.Count > 0)
    {
      var _ = _communicationHandler.BroadcastOutputsWithFiles(outputValues, fileOutputs);
    }
  }
}

/// <summary>
///   Event args for parameter changes
/// </summary>
public class ParametersChangedEventArgs : EventArgs
{
  public GH_Document Document { get; set; }
}

/// <summary>
///   Event args for metadata changes
/// </summary>
public class MetadataChangedEventArgs : EventArgs
{
  public List<AvailableParameter> Changes { get; set; }
  public bool RequiresRecalculation { get; set; }
}
