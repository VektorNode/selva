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
using Selva.Features.UIBuilder.Helpers;
using Selva.Features.UIBuilder.Models;
using Selva.Features.UIBuilder.Services;

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

  private SchemaCleanupService _cleanupService;

  // Core dependencies
  private CommunicationHandler _communicationHandler;

  // Document tracking
  private GH_Document _currentDocument;
  private bool _disposed;
  private UISchema _embeddedSchema;
  private Dictionary<string, object> _embeddedValues;
  private DocumentEventManager _eventManager;
  private SchemaManager _schemaManager;

  // Session and schema
  private string _sessionId;
  private ComponentStateManager _stateManager;
  private ValueApplicator _valueApplicator;
  private ValueCollector _valueCollector;
  private LocalWebServer _webServer;


  public GH_UIBuilderComponent()
    : base("UI Builder", "UIBuilder",
      "Build and interact with your UI - WebSocket-only communication",
      "Selva", "Core")
  {
  }

  /// <summary>
  ///   Helper property to check if WebSocket communication is available
  /// </summary>
  private bool IsConnected => _communicationHandler?.IsRunning == true;

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

  /// <summary>
  ///   Get current available parameters from document (single source of truth)
  /// </summary>
  private AvailableParameters GetCurrentAvailableParameters()
  {
    var document = OnPingDocument();
    if (document == null || _schemaManager == null)
      return new AvailableParameters { SessionId = _sessionId, Parameters = new List<AvailableParameter>() };

    return _schemaManager.ScanParameters(document);
  }

  /// <summary>
  ///   Get current available outputs from document (single source of truth)
  /// </summary>
  private List<AvailableOutput> GetCurrentAvailableOutputs()
  {
    var document = OnPingDocument();
    if (document == null || _schemaManager == null) return new List<AvailableOutput>();

    return _schemaManager.ScanOutputs(document);
  }

  /// <summary>
  ///   Get validated schema synchronized with current document state
  ///   This is the ONLY way to get schema - ensures it's always in sync with document
  /// </summary>
  private (UISchema Schema, List<Guid> RemovedIds) GetValidatedSchema()
  {
    var document = OnPingDocument();
    if (document == null || _embeddedSchema == null || _schemaManager == null) return (null, new List<Guid>());

    return _schemaManager.ValidateSchemaAndTrackChanges(_embeddedSchema, document, true);
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
    pManager.AddTextParameter("Session ID", "ID", "Session identifier", GH_ParamAccess.item);
    pManager.AddTextParameter("Info", "Info", "Status information", GH_ParamAccess.item);
    pManager.AddTextParameter("Schema", "Schema", "Current UI schema (JSON)", GH_ParamAccess.item);
  }

  protected override void SolveInstance(IGH_DataAccess DA)
  {
    var enable = false;
    DA.GetData(0, ref enable);

    // Initialize dependencies on first run
    InitializeDependencies();

    DA.SetData(0, _sessionId);

    // Get and validate document
    var document = OnPingDocument();
    if (!DocumentGuards.IsValid(document, out var error))
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, error);
      DA.SetData(1, ComponentMessageFormatter.CreateErrorInfoMessage("No document"));
      return;
    }

    // Process state transition
    var transition = _stateManager.ProcessEnableInput(enable);

    // Handle headless mode
    if (transition.IsHeadless)
    {
      HandleHeadlessMode(DA, document, transition);
      return;
    }

    // Update document tracking and events
    if (_currentDocument != document)
    {
      _currentDocument = document;
      _eventManager.RegisterEvents(document);
    }

    // Validate for duplicates on enable rising
    if (transition.EnableRising) ValidateForDuplicates(document);

    // Handle enabled state
    if (transition.IsEnabled)
    {
      HandleEnabledState(DA, document, transition);
      return;
    }

    // Handle disabled state
    if (transition.EnableFalling) HandleDisablingState(document);

    HandleDisabledState(DA, document);
  }

  /// <summary>
  ///   Initialize all dependencies on first run
  /// </summary>
  private void InitializeDependencies()
  {
    if (_schemaManager != null) return;

    if (string.IsNullOrEmpty(_sessionId)) _sessionId = CreateSessionId(AppConfig.Sessions.SessionIdLength);

    _schemaManager = new SchemaManager(_sessionId);
    _valueApplicator = new ValueApplicator();
    _valueCollector = new ValueCollector();
    _stateManager = new ComponentStateManager();
    _communicationHandler = new CommunicationHandler(_sessionId);
    _webServer = new LocalWebServer(0); // Use random available port
    _eventManager = new DocumentEventManager(_schemaManager, _valueCollector, _communicationHandler);
    _cleanupService = new SchemaCleanupService();

    // Wire up WebSocket events
    _communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
    _communicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
    _communicationHandler.OnClientConnected += HandleClientConnected;
    _communicationHandler.OnSchemaSaveRequested += HandleSchemaSave;

    // Wire up document events
    _eventManager.SolutionStarted += (s, e) => _stateManager.SetSolving(true);
    _eventManager.SolutionEnded += (s, e) =>
    {
      _stateManager.SetSolving(false);
      _eventManager.CollectAndBroadcastOutputs(_embeddedSchema);
      _eventManager.DetectAndBroadcastMetadataChanges(_embeddedSchema);
    };
    _eventManager.ParametersChanged += HandleParametersChanged;
    _eventManager.MetadataChanged += HandleMetadataChanged;
  }

  /// <summary>
  ///   Validate for duplicate parameter names
  /// </summary>
  private void ValidateForDuplicates(GH_Document document)
  {
    var currentParams = GetCurrentAvailableParameters();
    var duplicates = _schemaManager.ValidateDuplicates(currentParams);

    if (duplicates.Any())
    {
      var duplicateList = string.Join(", ", duplicates.Select(n => $"'{n}'"));
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
        $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
    }
  }

  /// <summary>
  ///   Handle headless mode execution
  /// </summary>
  private void HandleHeadlessMode(IGH_DataAccess DA, GH_Document document, StateTransition transition)
  {
    if (transition.EnableRising) ValidateForDuplicates(document);

    if (_embeddedSchema != null) _embeddedSchema = _schemaManager.ValidateSchema(_embeddedSchema, document);

    if (_embeddedValues != null && _embeddedSchema != null)
      _valueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, _embeddedValues, AddRuntimeMessage);

    DA.SetData(1, ComponentMessageFormatter.CreateInfoMessage(_sessionId, transition.IsEnabled, _embeddedSchema,
      false, true));
    DA.SetData(2,
      _embeddedSchema != null ? JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings) : "");
    Message = ComponentMessageFormatter.CreateDisplayMessage(transition.IsEnabled, false, _embeddedSchema, _sessionId);
  }

  /// <summary>
  ///   Handle enabled state
  /// </summary>
  private void HandleEnabledState(IGH_DataAccess DA, GH_Document document, StateTransition transition)
  {
    if (!_communicationHandler.IsRunning)
      try
      {
        // Start WebSocket server for real-time communication (async fire-and-forget)
        _ = Task.Run(async () =>
        {
          try
          {
            await _communicationHandler.StartAsync(msg =>
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
        if (!_webServer.IsRunning && HasEmbeddedWebAssets())
        {
          _webServer.Start();
          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Web UI available at: {_webServer.BaseUrl}/?session={_sessionId}");
        }

        Message = ComponentMessageFormatter.CreateDisplayMessage(true, true, _embeddedSchema, _sessionId);
      }
      catch (Exception ex)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to start servers: {ex.Message}");
        DA.SetData(1, ComponentMessageFormatter.CreateErrorInfoMessage("Could not start servers"));
        return;
      }

    if (_embeddedSchema != null && transition.EnableRising)
      _embeddedSchema = _schemaManager.ValidateSchema(_embeddedSchema, document);

    DA.SetData(1, ComponentMessageFormatter.CreateInfoMessage(_sessionId, true, _embeddedSchema, IsConnected));
    DA.SetData(2, _embeddedSchema != null
      ? JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings)
      : "");
  }

  /// <summary>
  ///   Handle transition to disabled state
  /// </summary>
  private void HandleDisablingState(GH_Document document)
  {
    if (IsConnected)
    {
      try
      {
        var _ = _communicationHandler.BroadcastMessage("disconnecting", new { reason = "Component disabled" });
        Thread.Sleep(100);
      }
      catch
      {
        /* ignore */
      }

      _communicationHandler.Stop();
    }

    var contextualParams = document.Objects.OfType<IGH_ContextualParameter>().ToList();
    ParameterTypeHelper.ClearContextualParameters(contextualParams, this);
    _valueApplicator?.Clear();
  }

  /// <summary>
  ///   Handle disabled state display
  /// </summary>
  private void HandleDisabledState(IGH_DataAccess DA, GH_Document document)
  {
    DA.SetData(1, ComponentMessageFormatter.CreateInfoMessage(_sessionId, false, _embeddedSchema, false));
    DA.SetData(2, _embeddedSchema != null
      ? JsonConvert.SerializeObject(_embeddedSchema, SchemaSerializationSettings)
      : "");
    Message = ComponentMessageFormatter.CreateDisplayMessage(false, false, _embeddedSchema, _sessionId);
  }

  /// <summary>
  ///   Handle value updates received via WebSocket
  /// </summary>
  private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
  {
    try
    {
      if (_stateManager.IsSolving) return;

      var document = OnPingDocument();
      if (!DocumentGuards.DocumentAndSchemaValid(document, _embeddedSchema, out _)) return;

      var updated = _valueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, values, AddRuntimeMessage);

      if (updated > 0) _embeddedValues = new Dictionary<string, object>(values);
    }
    catch (Exception ex)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
    }
  }

  /// <summary>
  ///   Transactional deletion handler - delegates to SchemaCleanupService
  /// </summary>
  private void HandleParameterDeletion(List<Guid> removedIds)
  {
    _cleanupService.CleanupDeletedParameters(
      removedIds,
      _embeddedSchema,
      _valueApplicator,
      _embeddedValues,
      _communicationHandler,
      _currentDocument,
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
      var currentValues = _valueCollector.CollectInputValues(document, _embeddedSchema, AddRuntimeMessage);

      var (validatedSchema, removedIds) = GetValidatedSchema();
      if (removedIds.Count > 0) HandleParameterDeletion(removedIds);

      var broadcastTask = _communicationHandler.BroadcastInitialData(
        validatedSchema ?? _embeddedSchema,
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
        var _ = _communicationHandler.BroadcastSchemaSaved(false, "No document available");
        return;
      }

      _embeddedSchema = _schemaManager.ValidateSchema(schema, document);
      var task = _communicationHandler.BroadcastSchemaSaved(true);

      //Expire to update component to reflect new schema (When user saves it will now properly internalize the new schema)
      document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc => { ExpireSolution(true); });

      AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully");
    }
    catch (Exception ex)
    {
      var _ = _communicationHandler.BroadcastSchemaSaved(false, ex.Message);
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

      var currentValues = _valueCollector.CollectInputValues(document, _embeddedSchema, AddRuntimeMessage);

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


  private void OpenUI()
  {
    try
    {
      // Use embedded web server if available, otherwise fall back to dev server
      var url = _webServer?.IsRunning == true
        ? $"{_webServer.BaseUrl}/?session={_sessionId}"
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
    openUIItem.Enabled = _stateManager != null && IsConnected;

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
      var currentOutputs = GetCurrentAvailableOutputs();

      if (_embeddedSchema == null)
      {
        if (currentParams.Parameters.Count > 0 || currentOutputs.Count > 0)
        {
          var _ = _communicationHandler.BroadcastMessage("parametersAdded",
            new { availableParams = currentParams.Parameters, availableOutputs = currentOutputs });
          AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Parameter(s)/Output(s) detected: {currentParams.Parameters.Count} params, {currentOutputs.Count} outputs. Check web UI.");
        }

        return;
      }

      var (updatedSchema, removedIds) = _schemaManager.ValidateSchemaAndTrackChanges(_embeddedSchema, e.Document);

      if (removedIds.Count > 0)
      {
        _embeddedSchema = updatedSchema;
        HandleParameterDeletion(removedIds);
        e.Document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc => { ExpireSolution(false); });
      }
      else
      {
        var newParamIds = currentParams.Parameters
          .Where(p => !_embeddedSchema.Inputs.Any(i => i.Id == p.Id))
          .Select(p => p.Id)
          .ToList();

        var newOutputIds = currentOutputs
          .Where(o => !_embeddedSchema.Outputs.Any(so => so.Id == o.Id))
          .Select(o => o.Id)
          .ToList();

        if (newParamIds.Count > 0 || newOutputIds.Count > 0)
        {
          var _ = _communicationHandler.BroadcastMessage("parametersAdded",
            new { availableParams = currentParams.Parameters, availableOutputs = currentOutputs });
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
  ///   Handle metadata changed event from DocumentEventManager
  /// </summary>
  private void HandleMetadataChanged(object sender, MetadataChangedEventArgs e)
  {
    try
    {
      if (e.Changes.Count > 0 && _currentDocument != null)
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

  private void Cleanup()
  {
    _communicationHandler?.Stop();
    _webServer?.Stop();
    _eventManager?.UnregisterEvents();
    _valueApplicator?.Clear();
    _schemaManager?.ClearMetadataCache();
    _stateManager?.Reset();
    _currentDocument = null;
  }

  protected virtual void Dispose(bool disposing)
  {
    if (_disposed) return;

    if (disposing)
    {
      Cleanup();
      _communicationHandler?.Dispose();
      _webServer?.Dispose();
      _eventManager?.Dispose();
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

    var lastValues = _valueApplicator?.GetLastAppliedValues();
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
