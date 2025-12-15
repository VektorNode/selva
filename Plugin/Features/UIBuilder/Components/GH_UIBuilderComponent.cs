using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Newtonsoft.Json;
using Rhino;
using Selva.Config;
using Selva.Core.Guards;
using Selva.Core.Helpers;
using Selva.Features.UIBuilder.Helpers;
using Selva.Features.UIBuilder.Models;
using Selva.Features.UIBuilder.Services;
using Selva.Properties;

namespace Selva.Features.UIBuilder.Components;

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

  private UIBuilderService _service;

  // Document tracking
  private GH_Document _currentDocument;
  private bool _disposed;
  private UISchema _embeddedSchema;
  private Dictionary<string, object> _embeddedValues;

  // Session and schema
  private string _sessionId;


  public GH_UIBuilderComponent()
    : base("UI Bridge", "UIBridge",
      "Build and interact with your UI - WebSocket-only communication",
      "Selva", "UI")
  {
  }

  /// <summary>
  ///   Helper property to check if WebSocket communication is available
  /// </summary>
  private bool IsConnected => _service?.CommunicationHandler?.IsRunning == true;

  public override Guid ComponentGuid => new("D4E5F6A7-B8C9-4D5E-0F1A-2B3C4D5E6F7A");

  protected override Bitmap Icon => Resources.UIBridge;

  /// <summary>
  ///   Override Locked property to handle right-click disable/enable
  /// </summary>
  public override bool Locked
  {
    get => base.Locked;
    set
    {
      // If component is being locked (disabled), cleanup communication
      if (value && !base.Locked)
      {
        CleanupCommunication();
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

  /// <summary>
  ///   Get current available parameters from document (single source of truth)
  /// </summary>
  private AvailableParameters GetCurrentAvailableParameters()
  {
    var document = OnPingDocument();
    if (document == null || _service?.SchemaManager == null)
      return new AvailableParameters
      { SessionId = _sessionId, Inputs = new List<AvailableInput>(), Outputs = new List<AvailableOutput>() };

    var availableParams = _service.SchemaManager.ScanParameters(document, this);

    // Validate and report duplicates only when requested
    var (duplicateInputs, duplicateOutputs) = _service.SchemaManager.GetValidationResults(availableParams);

    foreach (var duplicateParam in duplicateInputs)
    {
      AddRuntimeMessage(
        GH_RuntimeMessageLevel.Error,
        $"Duplicate parameter name: '{duplicateParam}'. Parameter names should be unique.");
    }

    foreach (var duplicateOutput in duplicateOutputs)
    {
      AddRuntimeMessage(
        GH_RuntimeMessageLevel.Error,
        $"Duplicate output name: '{duplicateOutput}'. Output names should be unique.");
    }

    return availableParams;
  }

  /// <summary>
  ///   Create a default schema with document metadata
  /// </summary>
  private UISchema CreateDefaultSchema(GH_Document document)
  {
    return new UISchema
    {
      Id = Guid.NewGuid().ToString(),
      Name = "New Schema",
      Description = "Configure your Grasshopper UI",
      ProjectFileName = document.Properties.ProjectFileName,
      DocumentId = document.DocumentID,
      PluginVersion = SchemaMigrator.PLUGIN_VERSION.ToString(),
      Tags = [],
      Created = DateTime.UtcNow,
      Inputs = [],
      Outputs = [],
      Layout = new LayoutConfig
      {
        Type = "tabbed",
        Gap = 16,
        Tabs = []
      },
      ViewerOptions = new ViewerOptions
      {
        EnableLocal = false,
        EnableRemote = false,
        BackgroundColor = "#ffffff"
      },
      InstanceSolve = true
    };
  }

  /// <summary>
  ///   Get current available outputs from document (single source of truth)
  /// </summary>
  private List<AvailableOutput> GetCurrentAvailableOutputs()
  {
    var document = OnPingDocument();
    if (document == null || _service?.SchemaManager == null) return new List<AvailableOutput>();

    return _service.SchemaManager.ScanOutputs(document);
  }

  /// <summary>
  ///   Get validated schema synchronized with current document state
  ///   This is the ONLY way to get schema - ensures it's always in sync with document
  /// </summary>
  private (UISchema Schema, List<Guid> RemovedIds) GetValidatedSchema()
  {
    var document = OnPingDocument();
    if (document == null || _embeddedSchema == null || _service?.SchemaManager == null) return (null, new List<Guid>());

    return _service.SchemaManager.ValidateSchemaAndTrackChanges(_embeddedSchema, document);
  }

  private static string CreateSessionId(int length)
  {
    if (length <= 0) throw new ArgumentOutOfRangeException(nameof(length), "Length must be > 0");

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

  /// <summary>
  ///   Check if embedded web assets are available in the assembly
  /// </summary>
  private static bool HasEmbeddedWebAssets()
  {
    var assembly = Assembly.GetExecutingAssembly();
    var resourceNames = assembly.GetManifestResourceNames();
    return resourceNames.Any(name => name.Contains("Selva.EmbeddedAssets.web.index.html"));
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
    var enable = false;
    DA.GetData(0, ref enable);

    // Initialize dependencies on first run
    InitializeDependencies();


    var document = OnPingDocument();
    if (!DocumentGuards.IsValid(document, out var error))
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, error);
      DA.SetData(1, ComponentMessageFormatter.CreateErrorInfoMessage("No document"));
      return;
    }

    var transition = _service.StateManager.ProcessEnableInput(enable);

    if (transition.IsHeadless)
    {
      HandleHeadlessMode(DA, document, transition);
      return;
    }

    // Update document tracking and events
    if (_currentDocument != document)
    {
      _currentDocument = document;
      _service.EventManager.RegisterEvents(document);
    }


    if (transition.IsEnabled)
    {
      HandleEnabledState(DA, document, transition);
      return;
    }

    if (transition.EnableFalling) HandleDisablingState(document);

    HandleDisabledState(DA, document);
  }

  /// <summary>
  ///   Initialize all dependencies on first run
  /// </summary>
  private void InitializeDependencies()
  {
    if (_service != null) return;

    if (string.IsNullOrEmpty(_sessionId)) _sessionId = CreateSessionId(AppConfig.Sessions.SessionIdLength);

    _service = new UIBuilderService(_sessionId);

    // Wire up WebSocket events
    _service.CommunicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
    _service.CommunicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
    _service.CommunicationHandler.OnClientConnected += HandleClientConnected;
    _service.CommunicationHandler.OnSchemaSaveRequested += HandleSchemaSave;

    // Wire up document events
    _service.EventManager.SolutionStarted += (s, e) => _service.StateManager.SetSolving(true);
    _service.EventManager.SolutionEnded += (s, e) =>
    {
      // Only broadcast outputs if we were actually solving (state changed)
      // This prevents duplicate broadcasts when SolutionEnded fires without a matching SolutionStarted
      var wasActuallySolving = _service.StateManager.SetSolving(false);
      if (wasActuallySolving)
      {
        _service.EventManager.CollectAndBroadcastOutputs(_embeddedSchema);
        _service.EventManager.DetectAndBroadcastMetadataChanges(_embeddedSchema);
      }
      ClearAllContextualParameters();
    };
    _service.EventManager.ParametersChanged += HandleParametersChanged;
    _service.EventManager.MetadataChanged += HandleMetadataChanged;
  }




  /// <summary>
  ///   Handle headless mode execution
  /// </summary>
  private void HandleHeadlessMode(IGH_DataAccess DA, GH_Document document, StateTransition transition)
  {
    if (_embeddedSchema != null) _embeddedSchema = _service.SchemaManager.ValidateSchema(_embeddedSchema, document);

    if (_embeddedValues != null && _embeddedSchema != null)
      _service.ValueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, _embeddedValues, AddRuntimeMessage);


    DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
    Message = ComponentMessageFormatter.CreateDisplayMessage(transition.IsEnabled, false, _embeddedSchema, _sessionId);
  }

  /// <summary>
  ///   Handle enabled state
  /// </summary>
  private void HandleEnabledState(IGH_DataAccess DA, GH_Document document, StateTransition transition)
  {
    if (!_service.CommunicationHandler.IsRunning)
      try
      {
        // Start WebSocket server for real-time communication (async fire-and-forget)
        _ = Task.Run(async () =>
        {
          try
          {
            await _service.CommunicationHandler.StartAsync(msg =>
            {
              /* Silent */
            });
          }
          catch (Exception ex)
          {
            RhinoApp.InvokeOnUiThread(new Action(() =>
            {
              AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"WebSocket server failed: {ex.Message}");
            }));
          }
        });

        // Start embedded web server (production mode only - check if resources exist)
        if (!_service.WebServer.IsRunning && HasEmbeddedWebAssets())
        {
          _service.WebServer.Start();
          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Web UI available at: {_service.WebServer.BaseUrl}/?session={_sessionId}");
        }

        Message = ComponentMessageFormatter.CreateDisplayMessage(true, true, _embeddedSchema, _sessionId);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to start servers: {ex.Message}");
        return;
      }

    if (_embeddedSchema != null && transition.EnableRising)
      _embeddedSchema = _service.SchemaManager.ValidateSchema(_embeddedSchema, document);

    DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
  }

  /// <summary>
  ///   Handle transition to disabled state
  /// </summary>
  private void HandleDisablingState(GH_Document document)
  {
    CleanupCommunication();

    var contextualParams = document.Objects.OfType<IGH_ContextualParameter>().ToList();
    ParameterTypeHelper.ClearContextualParameters(contextualParams, this);
    _service?.ValueApplicator?.Clear();
  }

  /// <summary>
  ///   Handle disabled state display
  /// </summary>
  private void HandleDisabledState(IGH_DataAccess DA, GH_Document document)
  {
    DA.SetData(0, _embeddedSchema != null ? new UISchemaGoo(_embeddedSchema) : null);
    Message = ComponentMessageFormatter.CreateDisplayMessage(false, false, _embeddedSchema, _sessionId);
  }

  /// <summary>
  ///   Handle value updates received via WebSocket
  /// </summary>
  private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
  {
    try
    {

      if (_service.StateManager.IsSolving)
      {
        Logger.Log("[UIBuilder] Skipping value update - currently solving");
        return;
      }

      var document = OnPingDocument();
      if (!DocumentGuards.DocumentAndSchemaValid(document, _embeddedSchema, out _))
      {
        Logger.Warn("[UIBuilder] Document or schema invalid, skipping value update");
        return;
      }

      var updated = _service.ValueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, values, AddRuntimeMessage);
      Logger.Log($"[UIBuilder] Applied {updated} value updates");

      if (updated > 0) _embeddedValues = new Dictionary<string, object>(values);
    }
    catch (Exception ex)
    {
      Logger.Error($"[UIBuilder] Error handling value update: {ex.Message}");
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
    }
  }

  /// <summary>
  ///   Transactional deletion handler - delegates to SchemaCleanupService
  /// </summary>
  private void HandleParameterDeletion(List<Guid> removedIds, GH_Document document)
  {
    _service.CleanupService.CleanupDeletedParameters(
      removedIds,
      _embeddedSchema,
      _service.ValueApplicator,
      _embeddedValues,
      _service.CommunicationHandler,
      document,
      AddRuntimeMessage
    );
  }

  /// <summary>
  ///   Handle client connection - send initial data
  /// </summary>
  private void HandleClientConnected(object sender, EventArgs e)
  {
    try
    {
      var document = OnPingDocument();
      if (!DocumentGuards.IsValid(document, out var error)) return;

      var currentParams = GetCurrentAvailableParameters();
      var currentOutputs = GetCurrentAvailableOutputs();
      var currentValues = _service.ValueCollector.CollectInputValues(document, _embeddedSchema, AddRuntimeMessage);

      var (validatedSchema, removedIds) = GetValidatedSchema();
      if (removedIds.Count > 0) HandleParameterDeletion(removedIds, document);

      // Create default schema if none exists
      var schemaToSend = validatedSchema ?? _embeddedSchema ?? CreateDefaultSchema(document);

      // Collect current outputs and display data to send with initial data
      // This ensures the client gets the current state immediately without needing a re-solve
      var outputs = new Dictionary<string, object>();
      var fileOutputs = new Dictionary<string, object>();
      var displayData = new List<object>();

      try
      {
        // Collect outputs using the event manager's logic
        // We need to access the private helper methods or duplicate logic here
        // Since we can't easily access private methods, we'll use the ValueCollector directly if possible
        // or just rely on the fact that if we have values, we might have outputs

        // For now, let's try to trigger a broadcast of outputs immediately after initial data
        // This is safer than modifying BroadcastInitialData signature
        Task.Run(async () =>
        {
          await Task.Delay(100); // Small delay to ensure client processed initial data
          RhinoApp.InvokeOnUiThread(new Action(() =>
          {
            _service.EventManager.CollectAndBroadcastOutputs(schemaToSend);
          }));
        });
      }
      catch (Exception ex)
      {
        Logger.Error($"Error collecting initial outputs: {ex.Message}");
      }

      var broadcastTask = _service.CommunicationHandler.BroadcastInitialData(
        schemaToSend,
        currentParams,
        currentOutputs,
        currentValues
      );
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
        var _ = _service.CommunicationHandler.BroadcastSchemaSaved(false, "No document available");
        return;
      }

      // Suppress solving state updates during schema save to avoid flashing indicator
      _service.CommunicationHandler.SetSuppressSolvingStateUpdates(true);

      // Enrich schema with document metadata
      schema.ProjectFileName = document.Properties.ProjectFileName;
      schema.DocumentId = document.DocumentID;
      schema.PluginVersion = SchemaMigrator.PLUGIN_VERSION.ToString();

      _embeddedSchema = _service.SchemaManager.ValidateSchema(schema, document);
      var task = _service.CommunicationHandler.BroadcastSchemaSaved(true);

      //Expire to update component to reflect new schema (When user saves it will now properly internalize the new schema)
      document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc =>
      {
        ExpireSolution(true);
      });

      // Keep suppression enabled for 1 second to cover the entire solve cycle
      Task.Run(async () =>
      {
        await Task.Delay(1000);
        _service.CommunicationHandler.SetSuppressSolvingStateUpdates(false);
      });

      AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully");
    }
    catch (Exception ex)
    {
      // Re-enable solving state updates if there's an error
      _service.CommunicationHandler.SetSuppressSolvingStateUpdates(false);
      var _ = _service.CommunicationHandler.BroadcastSchemaSaved(false, ex.Message);
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error saving schema: {ex.Message}");
    }
  }


  /// <summary>
  ///   Handle request for current input values from web UI
  /// </summary>
  private void HandleCurrentValuesRequest(object sender, EventArgs e)
  {
    try
    {
      var document = OnPingDocument();
      if (!DocumentGuards.DocumentAndSchemaValid(document, _embeddedSchema, out _)) return;

      var currentValues = _service.ValueCollector.CollectInputValues(document, _embeddedSchema, AddRuntimeMessage);

      if (currentValues.Count > 0)
      {
        var _ = _service.CommunicationHandler.BroadcastCurrentValues(currentValues);
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
        $"Error handling current values request: {ex.Message}");
    }
  }


  private void OpenUI()
  {
    try
    {
      // Use embedded web server if available, otherwise fall back to dev server
      var url = _service?.WebServer?.IsRunning == true
        ? $"{_service.WebServer.BaseUrl}/?session={_sessionId}"
        : $"http://localhost:5173/?session={_sessionId}";

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

  /// <summary>
  ///   Handle parameters changed event from DocumentEventManager
  /// </summary>
  private void HandleParametersChanged(object sender, ParametersChangedEventArgs e)
  {
    try
    {
      var currentParams = GetCurrentAvailableParameters();

      // Validate naming conflicts whenever parameters change
      if (_embeddedSchema == null)
      {
        if (currentParams.Inputs.Count > 0 || currentParams.Outputs.Count > 0)
        {
          _ = _service.CommunicationHandler.BroadcastMessage("parametersAdded",
            new { availableParams = currentParams })
            .ContinueWith(t =>
            {
              if (t.IsFaulted)
              {
                Logger.Error("Failed to broadcast parametersAdded", t.Exception);
                RhinoApp.InvokeOnUiThread(new Action(() =>
                  AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Failed to broadcast parametersAdded")));
              }
            });
          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Parameter(s)/Output(s) detected: {currentParams.Inputs.Count} params, {currentParams.Outputs.Count} outputs. Check web UI.");
        }

        return;
      }

      var (updatedSchema, removedIds) = _service.SchemaManager.ValidateSchemaAndTrackChanges(_embeddedSchema, e.Document);

      if (removedIds.Count > 0)
      {
        _embeddedSchema = updatedSchema;
        HandleParameterDeletion(removedIds, e.Document);
        e.Document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs,
          doc => { ExpireSolution(false); });
      }
      else
      {
        var newParamIds = currentParams.Inputs
          .Where(p => !_embeddedSchema.Inputs.Any(i => i.Id == p.Id))
          .Select(p => p.Id)
          .ToList();

        var newOutputIds = currentParams.Outputs
          .Where(o => !_embeddedSchema.Outputs.Any(so => so.Id == o.Id))
          .Select(o => o.Id)
          .ToList();

        if (newParamIds.Count > 0 || newOutputIds.Count > 0)
        {
          _ = _service.CommunicationHandler.BroadcastMessage("parametersAdded",
            new { availableParams = currentParams })
            .ContinueWith(t =>
            {
              if (t.IsFaulted)
              {
                Logger.Error("Failed to broadcast parametersAdded", t.Exception);
                RhinoApp.InvokeOnUiThread(new Action(() =>
                  AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Failed to broadcast parametersAdded")));
              }
            });
          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"New items added: {newParamIds.Count} param(s), {newOutputIds.Count} output(s). Check web UI.");
        }
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error updating schema: {ex.Message}");
    }
  }

  /// <summary>
  ///   Clear contextual data from all inputs and outputs after each solve
  /// </summary>
  private void ClearAllContextualParameters()
  {
    var document = OnPingDocument();
    if (document == null) return;

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
        if (ParameterTypeHelper.IsContextOutputComponent(obj) || ParameterTypeHelper.IsContextBakeComponent(obj))
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
  ///   Handle metadata changed event from DocumentEventManager
  /// </summary>
  private void HandleMetadataChanged(object sender, MetadataChangedEventArgs e)
  {
    try
    {
      if ((e.Changes.Inputs.Count > 0 || e.Changes.Outputs.Count > 0) && _currentDocument != null)
      {
        _currentDocument.Modified();

        if (e.RequiresRecalculation)
        {
          ExpireSolution(false);
          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Source parameter changed - recalculating");
        }
      }
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error handling metadata changes: {ex.Message}");
    }
  }

  /// <summary>
  ///   Cleanup communication servers and notify clients
  /// </summary>
  private void CleanupCommunication()
  {
    if (IsConnected)
    {
      try
      {
        var _ = _service.CommunicationHandler.BroadcastMessage("disconnecting", new { reason = "Component disabled" });
        Thread.Sleep(100);
      }
      catch (Exception ex)
      {
        Logger.Warn($"Error during communication cleanup: {ex.Message}");
      }

      _service.CommunicationHandler.Stop();
    }

    _service?.WebServer?.Stop();
  }

  private void Cleanup()
  {
    CleanupCommunication();
    _service?.EventManager?.UnregisterEvents();
    _service?.ValueApplicator?.Clear();
    _service?.SchemaManager?.ClearMetadataCache();
    _service?.StateManager?.Reset();
    _currentDocument = null;
  }

  protected virtual void Dispose(bool disposing)
  {
    if (_disposed) return;

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
    if (!string.IsNullOrEmpty(_sessionId)) writer.SetString("SessionId", _sessionId);

    if (_embeddedSchema != null)
      try
      {
        // Ensure version is set before saving
        if (string.IsNullOrEmpty(_embeddedSchema.SchemaVersion))
          _embeddedSchema.SchemaVersion = SchemaMigrator.CURRENT_SCHEMA_VERSION.ToString();

        _embeddedSchema.LastModified = DateTime.UtcNow;

        var schemaJson = JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings);
        writer.SetString("Schema", schemaJson);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Could not save schema: {ex.Message}");
      }

    var lastValues = _service?.ValueApplicator?.GetLastAppliedValues();
    if (lastValues != null && lastValues.Count > 0)
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

    return base.Write(writer);
  }

  public override bool Read(GH_IReader reader)
  {
    if (reader.ItemExists("SessionId")) _sessionId = reader.GetString("SessionId");

    if (reader.ItemExists("Schema"))
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
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
              $"Schema migrated from v{originalVersion ?? "legacy"} to v{_embeddedSchema.SchemaVersion}");
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

    if (reader.ItemExists("Values"))
      try
      {
        var valuesJson = reader.GetString("Values");
        if (!string.IsNullOrEmpty(valuesJson))
          _embeddedValues = JsonConvert.DeserializeObject<Dictionary<string, object>>(valuesJson);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
          $"Could not load values: {ex.Message}");
      }

    return base.Read(reader);
  }
}
