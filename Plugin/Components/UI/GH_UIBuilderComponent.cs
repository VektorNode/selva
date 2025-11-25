using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;
using Selva.Components.Params;
using Selva.Config;
using Selva.Plugin.Models.Generated;
using Selva.Utils;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Rhino;

namespace Selva.Components.UI;

/// <summary>
///   Unified UI Builder component - WebSocket-only version
///   Switch between Schema Builder mode and Interactive Preview mode
/// </summary>
public class GH_UIBuilderComponent : GH_Component, IDisposable
{
  // JSON serialization settings that respect DefaultValueHandling and NullValueHandling attributes
  private static readonly JsonSerializerSettings SchemaSerializationSettings = new()
  {
    NullValueHandling = NullValueHandling.Ignore,
    DefaultValueHandling = DefaultValueHandling.Ignore
  };

  // Cache for available parameters (to send on client connect)
  private AvailableParameters _availableParams;
  private CommunicationHandler _communicationHandler;
  private GH_Document _currentDocument;
  private bool _disposed;

  // Embedded schema - persists with the .gh file
  private UISchema _embeddedSchema;

  // Embedded values - persists parameter values with the .gh file
  private Dictionary<string, object> _embeddedValues;

  // Track if enable input is from a toggle (stays true across multiple solves)
  private int _enableTrueCount;
  private bool _eventsRegistered;

  // Latched states (persist until explicitly turned off)
  private bool _isEnabled;
  private bool _isSolving;

  // Previous input states for edge detection (button support)
  private bool _lastEnable;

  /// <summary>
  ///   Helper property to check if WebSocket communication is available
  /// </summary>
  private bool IsConnected => _communicationHandler?.IsRunning == true;

  // Extracted responsibilities
  private SchemaManager _schemaManager;
  private string _sessionId;
  private ValueApplicator _valueApplicator;


  public GH_UIBuilderComponent()
    : base("UI Builder", "UIBuilder",
      "Build and interact with your UI - WebSocket-only communication",
      "Selva", "Core")
  {
  }

  public override Guid ComponentGuid => new("D4E5F6A7-B8C9-4D5E-0F1A-2B3C4D5E6F7A");

  protected override Bitmap Icon => null;

  public void Dispose()
  {
    Dispose(true);
    GC.SuppressFinalize(this);
  }

  ~GH_UIBuilderComponent()
  {
    Dispose(false);
  }

  private static string CreateSessionId(int length)
  {
    if (length <= 0)
    {
      throw new ArgumentOutOfRangeException(nameof(length), "Length must be > 0");
    }

    string EncodeUrlSafe(byte[] bytes)
    {
      return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    var id = EncodeUrlSafe(Guid.NewGuid().ToByteArray());

    while (id.Length < length)
    {
      var extra = new byte[12];
      using (var rng = RandomNumberGenerator.Create())
      {
        rng.GetBytes(extra);
      }

      id += EncodeUrlSafe(extra);
    }

    return id.Substring(0, length);
  }


  protected override void RegisterInputParams(GH_InputParamManager pManager)
  {
    pManager.AddBooleanParameter("Enable", "Enable", "Enable UI Builder (opens web interface)",
      GH_ParamAccess.item, false);
  }

  protected override void RegisterOutputParams(GH_OutputParamManager pManager)
  {
    pManager.AddTextParameter("Session ID", "ID", "Session identifier", GH_ParamAccess.item);
    pManager.AddTextParameter("Info", "Info", "Status information", GH_ParamAccess.item);
    pManager.AddTextParameter("Schema", "Schema", "Current UI schema (JSON)", GH_ParamAccess.item);
  }

  protected override void SolveInstance(IGH_DataAccess DA)
  {
    var enable = false;

    DA.GetData(0, ref enable);

    var enableRising = enable && !_lastEnable;
    var enableFalling = !enable && _lastEnable;

    _lastEnable = enable;

    // Enable state logic: Distinguishes between button press (single true) vs toggle (sustained true)
    // - Button press: enableTrueCount=1, isEnabled stays true on falling edge
    // - Toggle off: enableTrueCount>1, isEnabled becomes false on falling edge
    if (enableRising)
    {
      _isEnabled = true;
      _enableTrueCount = 1;
    }
    else if (enable)
    {
      _enableTrueCount++;
    }
    else if (enableFalling)
    {
      if (_enableTrueCount > 1)
      {
        _isEnabled = false;
      }

      _enableTrueCount = 0;
    }

    if (_schemaManager == null)
    {
      if (string.IsNullOrEmpty(_sessionId))
      {
        _sessionId = CreateSessionId(AppConfig.Sessions.SessionIdLength);
      }

      _schemaManager = new SchemaManager(_sessionId);
      _valueApplicator = new ValueApplicator();
      _communicationHandler = new CommunicationHandler(_sessionId);

      _communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
      _communicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
      _communicationHandler.OnClientConnected += HandleClientConnected;
      _communicationHandler.OnSchemaSaveRequested += HandleSchemaSave;
    }

    DA.SetData(0, _sessionId);

    var document = OnPingDocument();
    if (document == null)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Could not access Grasshopper document");
      DA.SetData(1, "ERROR: No document");
      return;
    }

    var isRunningInHeadless = RhinoDoc.ActiveDoc == null || RhinoApp.IsRunningHeadless ||
                              RhinoDoc.ActiveDoc.IsHeadless;

    if (isRunningInHeadless)
    {
      if (enableRising)
      {
        _availableParams = _schemaManager.ScanParameters(document);
        var duplicates = _schemaManager.ValidateDuplicates(_availableParams);

        if (duplicates.Any())
        {
          var duplicateList = string.Join(", ", duplicates.Select(n => $"'{n}'"));
          AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
            $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
        }
      }

      if (_embeddedSchema != null)
      {
        _embeddedSchema = _schemaManager.ValidateSchema(_embeddedSchema, document);
      }

      if (_embeddedValues != null && _embeddedSchema != null)
      {
        _valueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, _embeddedValues,
          AddRuntimeMessage);
      }

      DA.SetData(1, $"Session: {_sessionId}\nStatus: Headless Mode\nSchema loaded (no WebSocket)");
      DA.SetData(2, _embeddedSchema != null ? JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings) : "");
      Message = "Headless • No WebSocket";
      return;
    }

    if (_currentDocument != document)
    {
      UnregisterDocumentEvents();
      _currentDocument = document;
      RegisterDocumentEvents();
    }

    if (enableRising)
    {
      _availableParams = _schemaManager.ScanParameters(document);
      var duplicates = _schemaManager.ValidateDuplicates(_availableParams);

      if (duplicates.Any())
      {
        var duplicateList = string.Join(", ", duplicates.Select(n => $"'{n}'"));
        AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
          $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
      }
    }

    if (_isEnabled)
    {
      if (!_communicationHandler.IsRunning)
      {
        try
        {
          _communicationHandler.Start(msg => { /* Silent - don't spam Message */ });
          Message = $"Ready • {_sessionId}";
        }
        catch (Exception ex)
        {
          AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
            $"Failed to start WebSocket server: {ex.Message}");
          DA.SetData(1, "ERROR: Could not start WebSocket");
          return;
        }
      }

      if (_embeddedSchema != null && enableRising)
      {
        _embeddedSchema = _schemaManager.ValidateSchema(_embeddedSchema, document);
      }

      if (_embeddedSchema != null)
      {
        DA.SetData(1,
          $"Session: {_sessionId}\nStatus: Active (WebSocket)\nSchema: {_embeddedSchema.Inputs.Count} inputs, {_embeddedSchema.Outputs.Count} outputs\nSwitch modes in web UI");
        DA.SetData(2, JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings));
      }
      else
      {
        DA.SetData(1,
          $"Session: {_sessionId}\nStatus: Active (WebSocket)\nWaiting for schema...\nSwitch to Build mode in web UI");
      }

      return;
    }

    if (enableFalling && IsConnected)
    {
      try
      {
        // Notify clients before stopping
        var _ = _communicationHandler.BroadcastMessage("disconnecting",
          new { reason = "Component disabled" });
        Thread.Sleep(100);
      }
      catch
      {
        /* ignore */
      }

      _communicationHandler.Stop();
    }

    var contextualParams = document.Objects.OfType<IGH_ContextualParameter>().ToList();
    var result = ParameterTypeHelper.ClearContextualParameters(contextualParams, this);

    _valueApplicator?.Clear();
    Message = "Disabled";

    if (_embeddedSchema != null)
    {
      DA.SetData(1,
        $"Session: {_sessionId}\nStatus: Disabled\nSchema: {_embeddedSchema.Inputs.Count} inputs, {_embeddedSchema.Outputs.Count} outputs (saved)\nSet Enable to true to start");
      DA.SetData(2, JsonConvert.SerializeObject(_embeddedSchema));
      Message = "Offline";
    }
    else
    {
      DA.SetData(1, $"Session: {_sessionId}\nStatus: Disabled\nNo schema yet\nSet Enable to true to start");
      Message = "Offline • No Schema";
    }
  }

  /// <summary>
  ///   Handle value updates received via WebSocket
  /// </summary>
  private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
  {
    try
    {
      if (_isSolving)
      {
        return;
      }

      var document = OnPingDocument();
      if (document == null || _embeddedSchema == null)
      {
        return;
      }

      // Apply values and schedule solution
      var updated =
        _valueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, values, AddRuntimeMessage);

      if (updated > 0)
      {
        _embeddedValues = new Dictionary<string, object>(values);
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
    }
  }

  /// <summary>
  ///   Handle client connection - send initial data
  /// </summary>
  private void HandleClientConnected(object sender, EventArgs e)
  {
    try
    {
      var document = OnPingDocument();
      if (document == null)
      {
        return;
      }

      var currentValues = CollectCurrentValues(document);

      // Broadcast initial data to the newly connected client
      var _ = _communicationHandler.BroadcastInitialData(_embeddedSchema, _availableParams, currentValues);
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error sending initial data: {ex.Message}");
    }
  }

  /// <summary>
  ///   Handle schema save request from web UI
  /// </summary>
  private void HandleSchemaSave(object sender, UISchema schema)
  {
    try
    {
      var document = OnPingDocument();
      if (document == null)
      {
        var _ = _communicationHandler.BroadcastSchemaSaved(false, "No document available");
        return;
      }

      _embeddedSchema = _schemaManager.ValidateSchema(schema, document);
      var task = _communicationHandler.BroadcastSchemaSaved(true);

      //Expire to update component to reflect new schema (When user saves it will now properly internalize the new schema)
      document.ScheduleSolution(10, doc => { ExpireSolution(true); });

      AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully");
    }
    catch (Exception ex)
    {
      var _ = _communicationHandler.BroadcastSchemaSaved(false, ex.Message);
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error saving schema: {ex.Message}");
    }
  }

  /// <summary>
  ///   Collect current values from all input parameters
  /// </summary>
  private Dictionary<string, object> CollectCurrentValues(GH_Document document)
  {
    var currentValues = new Dictionary<string, object>();

    if (_embeddedSchema == null)
    {
      return currentValues;
    }

    foreach (var input in _embeddedSchema.Inputs)
    {
      try
      {
        var paramObject = document.FindObject(input.Id, false);
        if (paramObject == null)
        {
          continue;
        }

        if (paramObject is IGH_Param ghParam)
        {
          if (ghParam is GetValueListParameter valueListParam)
          {
            var valueData = valueListParam.VolatileData;
            if (valueData != null && !valueData.IsEmpty)
            {
              var allData = valueData.AllData(true).ToList();
              if (allData.Count == 1)
              {
                // Extract key from GH_ValueListData
                currentValues[input.Id.ToString()] = ExtractKeyFromValueListData(allData[0]);
              }
              else if (allData.Count > 1)
              {
                var values = allData.Select(d => ExtractKeyFromValueListData(d)).ToList();
                currentValues[input.Id.ToString()] = values;
              }
            }
          }
          else if (ghParam.SourceCount == 1)
          {
            // For regular parameters, read from their source
            var valueData = ghParam.Sources[0].VolatileData;
            if (valueData != null && !valueData.IsEmpty)
            {
              var allData = valueData.AllData(true).ToList();
              if (allData.Count == 1)
              {
                currentValues[input.Id.ToString()] = ExtractValue(allData[0]);
              }
              else if (allData.Count > 1)
              {
                var values = allData.Select(d => ExtractValue(d)).ToList();
                currentValues[input.Id.ToString()] = values;
              }
            }
          }
        }
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Error collecting current value for '{input.Nickname}': {ex.Message}");
      }
    }

    return currentValues;
  }

  private object ExtractKeyFromValueListData(IGH_Goo data)
  {
    if (data is GH_ValueListData valueListData)
    {
      // Return the KEY (name)
      return valueListData.SelectedName;
    }

    // Fallback for other types
    return ExtractValue(data);
  }

  private object ExtractValue(IGH_Goo data)
  {
    if (data is GH_String ghString)
    {
      return ghString.Value;
    }

    if (data is GH_Number ghNumber)
    {
      return ghNumber.Value;
    }

    if (data is GH_Integer ghInteger)
    {
      return ghInteger.Value;
    }

    if (data is GH_Boolean ghBoolean)
    {
      return ghBoolean.Value;
    }

    if (data.CastTo(out string strValue))
    {
      return strValue;
    }

    return data?.ToString() ?? "";
  }


  /// <summary>
  ///   Handle request for current input values from web UI
  /// </summary>
  private void HandleCurrentValuesRequest(object sender, EventArgs e)
  {
    try
    {
      var document = OnPingDocument();
      if (document == null || _embeddedSchema == null)
      {
        return;
      }

      var currentValues = CollectCurrentValues(document);

      if (currentValues.Count > 0)
      {
        var _ = _communicationHandler.BroadcastCurrentValues(currentValues);
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
        $"Error handling current values request: {ex.Message}");
    }
  }

  /// <summary>
  ///   Collect output values and send via WebSocket
  /// </summary>
  private void CollectAndSendOutputs(GH_Document document, UISchema schema)
  {
    if (document == null || schema?.Outputs == null || schema.Outputs.Count == 0)
    {
      return;
    }

    if (!_communicationHandler.IsRunning)
    {
      return;
    }

    var outputValues = new Dictionary<string, object>();

    foreach (var output in schema.Outputs)
    {
      try
      {
        var paramObject = document.FindObject(output.Id, false);
        if (paramObject == null)
        {
          continue;
        }

        if (paramObject is IGH_Component ghParam)
        {
          var paramData = ghParam.Params.Input.FirstOrDefault()?.VolatileData;
          if (paramData != null && !paramData.IsEmpty)
          {
            var allData = paramData.AllData(true).ToList();
            if (allData.Count == 1)
            {
              outputValues[output.Id.ToString()] = ExtractValue(allData[0]);
            }
            else if (allData.Count > 1)
            {
              var values = allData.Select(d => ExtractValue(d)).ToList();
              outputValues[output.Id.ToString()] = values;
            }
          }
        }
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Error collecting output '{output.Nickname}': {ex.Message}");
      }
    }

    if (outputValues.Count > 0)
    {
      try
      {
        var _ = _communicationHandler.BroadcastOutputs(outputValues);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error sending outputs: {ex.Message}");
      }
    }
  }


  private void OpenUI()
  {
    try
    {
      var url = $"http://localhost:5173/?session={_sessionId}";
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
  ///   Add custom context menu items to the component's right-click menu
  /// </summary>
  public override bool AppendMenuItems(ToolStripDropDown menu)
  {
    base.AppendMenuItems(menu);

    // Add a separator
    menu.Items.Add(new ToolStripSeparator());

    // Add "Open UI in Browser" menu item
    var openUIItem = new ToolStripMenuItem(
      "Open UI in Browser",
      null,
      (s, e) => OpenUI()
    )
    {
      ToolTipText = "Open the interactive UI preview in your default web browser"
    };

    // Only enable if the component is active and connected
    openUIItem.Enabled = _isEnabled && IsConnected;

    menu.Items.Add(openUIItem);

    return true;
  }

  public override void RemovedFromDocument(GH_Document document)
  {
    base.RemovedFromDocument(document);
    Cleanup();
  }

  private void RegisterDocumentEvents()
  {
    if (_currentDocument == null || _eventsRegistered)
    {
      return;
    }

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

  private void UnregisterDocumentEvents()
  {
    if (!_eventsRegistered)
    {
      return;
    }

    try
    {
      Instances.DocumentServer.DocumentRemoved -= OnDocumentRemoved;
    }
    catch
    {
      /* ignore */
    }

    if (_currentDocument != null)
    {
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
    }

    _eventsRegistered = false;
  }

  /// <summary>
  ///   Handle undo/redo state changes - detects property modifications
  ///   Fires when user changes nicknames, descriptions, min/max values, etc.
  /// </summary>
  private void OnUndoStateChanged(object sender, GH_DocUndoEventArgs e)
  {
    if (_embeddedSchema == null || _currentDocument == null || !IsConnected)
    {
      return;
    }

    // Detect metadata changes when undo/redo occurs
    try
    {
      var metadataChanges = _schemaManager.DetectMetadataChanges(_currentDocument, _embeddedSchema);
      if (metadataChanges.Count > 0)
      {
        var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);
        Console.WriteLine($"[UIBuilder] Undo/Redo detected - broadcast {metadataChanges.Count} metadata change(s)");
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
        $"Error detecting metadata changes on undo/redo: {ex.Message}");
    }
  }

  private void OnDocumentRemoved(GH_DocumentServer sender, GH_Document doc)
  {
    if (_currentDocument != null && doc != null && doc.DocumentID == _currentDocument.DocumentID)
    {
      Cleanup();
    }
  }

  private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
  {
    _isSolving = true;

    // Notify web UI that Grasshopper is solving
    if (IsConnected)
    {
      var _ = _communicationHandler.BroadcastSolvingState(true);
    }
  }

  private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
  {
    _isSolving = false;

    if (_embeddedSchema != null && _currentDocument != null)
    {
      CollectAndSendOutputs(_currentDocument, _embeddedSchema);

      // Detect metadata changes (nickname, min/max, stepsize, options) and broadcast updates
      if (IsConnected)
      {
        try
        {
          var metadataChanges = _schemaManager.DetectMetadataChanges(_currentDocument, _embeddedSchema);
          if (metadataChanges.Count > 0)
          {
            var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);

            // Mark document as modified so schema changes are persisted on save
            _currentDocument.Modified();

            // Check if any changes are for source parameters (ValueList options, number constraints)
            // If so, trigger a new solution to recalculate downstream components
            var hasSourceChanges = metadataChanges.Any(change =>
            {
              // Check if this is a ValueList or number input with changed options/constraints
              var paramObj = _currentDocument.FindObject(change.Id, false);
              if (paramObj is GetValueListParameter vl && change.Options != null)
              {
                return true; // ValueList options changed
              }

              if (paramObj is IGH_ContextualParameter param &&
                  (change.Minimum != null || change.Maximum != null || change.StepSize != null))
              {
                return true; // Number constraints changed
              }

              return false;
            });

            // If source parameters changed, expire solution to trigger full recalculation
            if (hasSourceChanges)
            {
              ExpireSolution(false);
              AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "Source parameter changed - recalculating");
            }
          }
        }
        catch (Exception ex)
        {
          AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
            $"Error detecting metadata changes: {ex.Message}");
        }
      }
    }

    // Notify web UI that Grasshopper is done solving
    if (IsConnected)
    {
      var _ = _communicationHandler.BroadcastSolvingState(false);
    }
  }

  private void OnObjectsChanged(object sender, GH_DocObjectEventArgs e)
  {
    // Only react if we're enabled and can communicate
    if (_currentDocument == null || !IsConnected)
    {
      return;
    }

    // Check if any changed objects are contextual parameters or output components
    var relevantChange = false;
    foreach (var obj in e.Objects)
    {
      if (obj is IGH_ContextualParameter)
      {
        relevantChange = true;
        break;
      }

      if (ParameterTypeHelper.IsContextOutputComponent(obj))
      {
        relevantChange = true;
        break;
      }
    }

    if (!relevantChange)
    {
      return;
    }

    try
    {
      // Always rescan available parameters when objects change
      var currentParams = _schemaManager.ScanParameters(_currentDocument);
      _availableParams = currentParams;

      // If we don't have a schema yet, just notify about new parameters
      if (_embeddedSchema == null)
      {
        if (currentParams.Parameters.Count > 0)
        {
          var broadcastTask = _communicationHandler.BroadcastMessage("parametersAdded",
            new { availableParams = currentParams.Parameters });

          try
          {
            broadcastTask.Wait(10);
          }
          catch
          {
          }

          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Parameter(s) detected: {currentParams.Parameters.Count} available. Check web UI.");
        }

        return;
      }

      var (updatedSchema, removedIds) =
        _schemaManager.ValidateSchemaAndTrackChanges(_embeddedSchema, _currentDocument);

      // Broadcast schema update for removals
      if (removedIds.Count > 0)
      {
        _embeddedSchema = updatedSchema;

        if (_embeddedValues != null)
        {
          foreach (var removedId in removedIds)
          {
            _embeddedValues.Remove(removedId.ToString());
          }
        }

        var lastValues = _valueApplicator?.GetLastAppliedValues();
        if (lastValues != null)
        {
          foreach (var removedId in removedIds)
          {
            lastValues.Remove(removedId.ToString());
          }

          _valueApplicator?.SetLastAppliedValues(lastValues);
        }

        var broadcastTask = _communicationHandler.BroadcastSchemaUpdate(_embeddedSchema, removedIds);

        try
        {
          broadcastTask.Wait(10);
        }
        catch
        {
        }

        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
          $"Schema updated: {removedIds.Count} parameter(s) removed from UI");

        _currentDocument.ScheduleSolution(10, doc => { ExpireSolution(false); });
      }
      else
      {
        // No removals, but check if new parameters were added
        var newParamIds = currentParams.Parameters
          .Where(p => !_embeddedSchema.Inputs.Any(i => i.Id == p.Id) &&
                      !_embeddedSchema.Outputs.Any(o => o.Id == p.Id))
          .Select(p => p.Id)
          .ToList();

        if (newParamIds.Count > 0)
        {
          // New parameters added - send full parameter list to web UI
          var broadcastTask = _communicationHandler.BroadcastMessage("parametersAdded",
            new { availableParams = currentParams.Parameters });

          try
          {
            broadcastTask.Wait(10);
          }
          catch
          {
          }

          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"New parameter(s) added: {newParamIds.Count} available. Check web UI.");
        }
      }

      // Also check for metadata changes (nickname, description, min/max, stepsize)
      // This catches property changes that don't trigger structural updates
      var metadataChanges = _schemaManager.DetectMetadataChanges(_currentDocument, _embeddedSchema);
      if (metadataChanges.Count > 0)
      {
        var _ = _communicationHandler.BroadcastMetadataChanges(metadataChanges);
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
        $"Error updating schema: {ex.Message}");
    }
  }

  private void Cleanup()
  {
    _communicationHandler?.Stop();
    UnregisterDocumentEvents();
    _valueApplicator?.Clear();
    _schemaManager?.ClearMetadataCache();
    _currentDocument = null;
    _isEnabled = false;
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
      _communicationHandler?.Dispose();
    }

    _disposed = true;
  }

  // Schema persistence - save/load with .gh file
  public override bool Write(GH_IWriter writer)
  {
    if (!string.IsNullOrEmpty(_sessionId))
    {
      writer.SetString("SessionId", _sessionId);
    }

    if (_embeddedSchema != null)
    {
      try
      {
        // Ensure version is set before saving
        if (string.IsNullOrEmpty(_embeddedSchema.SchemaVersion))
        {
          _embeddedSchema.SchemaVersion = SchemaMigrator.CURRENT_SCHEMA_VERSION.ToString();
        }

        _embeddedSchema.LastModified = DateTime.UtcNow;

        var schemaJson = JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings);
        writer.SetString("Schema", schemaJson);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Could not save schema: {ex.Message}");
      }
    }

    var lastValues = _valueApplicator?.GetLastAppliedValues();
    if (lastValues != null && lastValues.Count > 0)
    {
      try
      {
        var valuesJson = JsonConvert.SerializeObject(lastValues);
        writer.SetString("Values", valuesJson);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Could not save values: {ex.Message}");
      }
    }

    return base.Write(writer);
  }

  public override bool Read(GH_IReader reader)
  {
    if (reader.ItemExists("SessionId"))
    {
      _sessionId = reader.GetString("SessionId");
    }

    if (reader.ItemExists("Schema"))
    {
      try
      {
        var schemaJson = reader.GetString("Schema");
        if (!string.IsNullOrEmpty(schemaJson))
        {
          var rawSchema = JsonConvert.DeserializeObject<UISchema>(schemaJson);

          // MIGRATE TO CURRENT VERSION
          var originalVersion = rawSchema.SchemaVersion;
          _embeddedSchema = SchemaMigrator.MigrateToCurrentVersion(rawSchema);

          // Log if migration occurred
          if (originalVersion != _embeddedSchema.SchemaVersion)
          {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
              $"Schema migrated from v{originalVersion ?? "legacy"} to v{_embeddedSchema.SchemaVersion}");
          }
        }
      }
      catch (IncompatibleSchemaException ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
        return false;
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Could not load schema: {ex.Message}");
      }
    }

    if (reader.ItemExists("Values"))
    {
      try
      {
        var valuesJson = reader.GetString("Values");
        if (!string.IsNullOrEmpty(valuesJson))
        {
          _embeddedValues = JsonConvert.DeserializeObject<Dictionary<string, object>>(valuesJson);
        }
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Could not load values: {ex.Message}");
      }
    }

    return base.Read(reader);
  }
}
