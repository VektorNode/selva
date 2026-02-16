using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;
using Selva.Core.Models;
using Selva.Grasshopper.Features.UIBuilder.Services.Communication;
using Selva.Grasshopper.Features.UIBuilder.Services.Events;
using Selva.Grasshopper.Features.UIBuilder.Services.Persistence;
using Selva.Grasshopper.Features.UIBuilder.Services.Schema;
using Selva.Grasshopper.Features.UIBuilder.Services.State;
using Selva.Grasshopper.Features.UIBuilder.Services.Values;
using Selva.Grasshopper.Utilities.Helpers;
using Selva.Grasshopper.Utilities.Guards;

namespace Selva.Grasshopper.Features.UIBuilder.Services;

/// <summary>
/// Orchestrates communication between the web UI and Grasshopper component.
/// Handles WebSocket event routing, message processing, and response broadcasting.
/// </summary>
public class BridgeCommunicationService : IDisposable
{
	private readonly CommunicationHandler _communicationHandler;
	private readonly SchemaManager _schemaManager;
	private readonly ValueApplicator _valueApplicator;
	private readonly ValueCollector _valueCollector;
	private readonly ComponentStateManager _stateManager;
	private readonly DocumentEventManager _eventManager;
	private readonly Version _pluginVersion;
	private readonly string _sessionId;

	private GH_Component _component;
	private bool _disposed;

	// Callbacks to access component's schema/values (single source of truth)
	private Func<UISchema> _getSchema;
	private Action<UISchema> _setSchema;

	public BridgeCommunicationService(
		CommunicationHandler communicationHandler,
		SchemaManager schemaManager,
		ValueApplicator valueApplicator,
		ValueCollector valueCollector,
		ComponentStateManager stateManager,
		DocumentEventManager eventManager,
		Version pluginVersion,
		string sessionId)
	{
		_communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
		_schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
		_valueApplicator = valueApplicator ?? throw new ArgumentNullException(nameof(valueApplicator));
		_valueCollector = valueCollector ?? throw new ArgumentNullException(nameof(valueCollector));
		_stateManager = stateManager ?? throw new ArgumentNullException(nameof(stateManager));
		_eventManager = eventManager ?? throw new ArgumentNullException(nameof(eventManager));
		_pluginVersion = pluginVersion ?? throw new ArgumentNullException(nameof(pluginVersion));
		_sessionId = sessionId ?? throw new ArgumentNullException(nameof(sessionId));
	}

	/// <summary>
	/// Initialize the service and wire up event handlers.
	/// </summary>
	public void Initialize(
		GH_Component component,
		Func<UISchema> getSchema,
		Action<UISchema> setSchema)
	{
		_component = component ?? throw new ArgumentNullException(nameof(component));
		_getSchema = getSchema ?? throw new ArgumentNullException(nameof(getSchema));
		_setSchema = setSchema ?? throw new ArgumentNullException(nameof(setSchema));

		// Wire up WebSocket event handlers
		_communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
		_communicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
		_communicationHandler.OnClientConnected += HandleClientConnected;
		_communicationHandler.OnSchemaSaveRequested += HandleSchemaSave;
		_communicationHandler.OnSyncPreviewRequested += HandleSyncPreviewRequest;
		_communicationHandler.OnSyncChangesApply += HandleApplySyncChanges;
	}

	public void Dispose()
	{
		if (_disposed) return;

		// Unwire event handlers
		if (_communicationHandler != null)
		{
			_communicationHandler.OnValuesReceived -= HandleWebSocketValueUpdate;
			_communicationHandler.OnCurrentValuesRequested -= HandleCurrentValuesRequest;
			_communicationHandler.OnClientConnected -= HandleClientConnected;
			_communicationHandler.OnSchemaSaveRequested -= HandleSchemaSave;
			_communicationHandler.OnSyncPreviewRequested -= HandleSyncPreviewRequest;
			_communicationHandler.OnSyncChangesApply -= HandleApplySyncChanges;
		}

		_disposed = true;
	}

	private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
	{
		try
		{
			if (_stateManager.IsSolving)
			{
				Logger.Log("[BridgeCommunicationService] Skipping value update - currently solving");
				BroadcastRuntimeMessageAsync("warning", "Skipping value update - currently solving");
				return;
			}

			var document = _component.OnPingDocument();
			var schema = _getSchema();
			if (!DocumentGuards.DocumentAndSchemaValid(document, schema, out _))
			{
				Logger.Warn("[BridgeCommunicationService] Document or schema invalid, skipping value update");
				BroadcastRuntimeMessageAsync("error", "Document or schema invalid");
				return;
			}

			var updated = _valueApplicator.ApplyValuesAndSchedule(document, schema, values,
				(level, msg) =>
				{
					_component.AddRuntimeMessage(level, msg);
					// Only broadcast errors and warnings, not info messages
					if (level == GH_RuntimeMessageLevel.Error || level == GH_RuntimeMessageLevel.Warning)
					{
						BroadcastRuntimeMessageAsync(ConvertMessageLevel(level), msg);
					}
				});

			// Values are updated in the component directly via ValueApplicator
		}
		catch (Exception ex)
		{
			Logger.Error($"[BridgeCommunicationService] Error handling value update: {ex.Message}", ex);
			_component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
			BroadcastRuntimeMessageAsync("error", $"Error handling value update: {ex.Message}");
		}
	}

	private void HandleClientConnected(object sender, EventArgs e)
	{
		try
		{
			var document = _component.OnPingDocument();
			if (!DocumentGuards.IsValid(document, out var error)) return;

			var schema = _getSchema();

			// Validate without deletion tracking - deletions come from document events, not client connects
			var validatedSchema = schema != null ? _schemaManager.ValidateSchema(schema, document) : null;
			var schemaToSend = validatedSchema ?? CreateDefaultSchema(document);
#if DEBUG
			Logger.Log($"[UIBuilder] ClientConnected — schema={schemaToSend.Name}, inputs={schemaToSend.Inputs?.Count}, outputs={schemaToSend.Outputs?.Count}");
#endif

			// Scan parameters and collect current values against the validated schema
			var currentParams = GetCurrentAvailableParameters(document);
			var currentValues = _valueCollector.CollectInputValues(document, schemaToSend, _component.AddRuntimeMessage);

			// Broadcast initial data
			_ = _communicationHandler.BroadcastInitialData(schemaToSend, currentParams, currentValues);

			// Only spin up the output broadcast if there are outputs registered in the schema
			if (schemaToSend.Outputs?.Count > 0)
			{
				Task.Run(async () =>
				{
					await Task.Delay(100);
					RhinoApp.InvokeOnUiThread(new Action(() => { _eventManager.CollectAndBroadcastOutputs(schemaToSend); }));
				});
			}
		}
		catch (Exception ex)
		{
			_component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error sending initial data: {ex.Message}");
		}
	}

	private void HandleSchemaSave(object sender, UISchema schema)
	{
		try
		{
			var document = _component.OnPingDocument();
			if (document == null)
			{
				_ = _communicationHandler.BroadcastSchemaSaved(false, "No document available");
				return;
			}

			// Suppress solving state updates and metadata broadcasts during schema save
			// Extended to 2000ms to cover full solution cycle (multiple SolutionStart/End events)
			_communicationHandler.SetSuppressSolvingStateUpdates(true, 2000);

			// Enrich schema with document metadata
			schema.ProjectFileName = document.Properties.ProjectFileName;
			schema.DocumentId = document.DocumentID;
			schema.PluginVersion = _pluginVersion.ToString();

			var validatedSchema = _schemaManager.ValidateSchema(schema, document);
#if DEBUG
			Logger.Log($"[UIBuilder] Save — inputs={validatedSchema.Inputs?.Count}, outputs={validatedSchema.Outputs?.Count}, layout={validatedSchema.Layout?.GetType().Name}");
#endif
			_setSchema(validatedSchema); // Update component's schema (single source of truth)

			// Reset metadata cache so the post-save re-solve establishes a fresh baseline.
			_schemaManager.ClearMetadataCache();

			_ = _communicationHandler.BroadcastSchemaSaved(true);

			// Schedule solution to update component
			GHDocumentMutator.ScheduleComponentExpire(document, _component, false);
#if DEBUG
			Logger.Log("[UIBuilder] Save complete — component expire scheduled");
#endif
			_component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully");
		}
		catch (Exception ex)
		{
			_communicationHandler.SetSuppressSolvingStateUpdates(false);
			_ = _communicationHandler.BroadcastSchemaSaved(false, ex.Message);
			_component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error saving schema: {ex.Message}");
		}
	}

	private void HandleCurrentValuesRequest(object sender, EventArgs e)
	{
		try
		{
			var document = _component.OnPingDocument();
			if (document == null) return;

			var schema = _getSchema();
			var currentValues = _valueCollector.CollectInputValues(document, schema, _component.AddRuntimeMessage);
			_ = _communicationHandler.BroadcastCurrentValues(currentValues);
		}
		catch (Exception ex)
		{
			Logger.Error($"[BridgeCommunicationService] Error handling current values request: {ex.Message}", ex);
		}
	}


	private DiscoveredParameters GetCurrentAvailableParameters(GH_Document document)
	{
		if (document == null || _schemaManager == null || _component == null)
		{
			return new DiscoveredParameters
			{
				SessionId = _sessionId,
				Inputs = new List<DiscoveredInput>(),
				Outputs = new List<DiscoveredOutput>()
			};
		}

		return _schemaManager.ScanParameters(document);
	}

	private UISchema CreateDefaultSchema(GH_Document document)
	{
		return new UISchema
		{
			Id = Guid.NewGuid().ToString(),
			Name = "New Schema",
			Description = "Configure your Grasshopper UI",
			ProjectFileName = document?.Properties.ProjectFileName ?? "untitled.gh",
			DocumentId = document?.DocumentID ?? Guid.Empty,
			PluginVersion = _pluginVersion.ToString(),
			Tags = [],
			Created = DateTime.UtcNow,
			Inputs = [],
			Outputs = [],
			Layout = new TabbedLayoutConfig
			{
				Tabs = []
			},
			ViewerOptions = new ViewerOptions
			{
				EnableLocal = false,
				EnableRemote = false,
				BackgroundColor = "#f3f3f3"
			},
			InstanceSolve = true
		};
	}

	private string ConvertMessageLevel(GH_RuntimeMessageLevel level)
	{
		return level switch
		{
			GH_RuntimeMessageLevel.Error => "error",
			GH_RuntimeMessageLevel.Warning => "warning",
			GH_RuntimeMessageLevel.Remark => "info",
			_ => "info"
		};
	}

	private void BroadcastRuntimeMessageAsync(string level, string message)
	{
		_ = Task.Run(async () =>
		{
			try
			{
				await _communicationHandler.BroadcastRuntimeMessage(level, message);
			}
			catch (Exception ex)
			{
				Logger.Warn($"Failed to broadcast runtime message: {ex.Message}");
			}
		});
	}

	private void HandleSyncPreviewRequest(object sender, UISchema schema)
	{
		try
		{
			var document = _component.OnPingDocument();
			if (document == null)
			{
				_ = _communicationHandler.BroadcastRuntimeMessage("error", "No document available");
				return;
			}

			// Compute the diff between current GH state and schema state
			var syncDiff = SchemaManager.ComputeSyncDiff(schema, document);

			// Broadcast the diff to the frontend
			_ = _communicationHandler.BroadcastSyncPreview(syncDiff);
		}
		catch (Exception ex)
		{
			Logger.Error($"[BridgeCommunicationService] Error computing sync preview: {ex.Message}", ex);
			_ = _communicationHandler.BroadcastRuntimeMessage("error", $"Error computing sync preview: {ex.Message}");
		}
	}

	private void HandleApplySyncChanges(object sender, List<SyncChange> changes)
	{
		try
		{
			var document = _component.OnPingDocument();
			if (document == null)
			{
				_ = _communicationHandler.BroadcastSyncApplied(false, "No document available");
				return;
			}

			var currentSchema = _getSchema();
			if (currentSchema == null)
			{
				_ = _communicationHandler.BroadcastSyncApplied(false, "No schema available");
				return;
			}

			// Apply the changes to both Grasshopper document and schema
			var updatedSchema = SchemaManager.ApplySyncChanges(changes, document, currentSchema);

			// If schema was modified, update it and broadcast the changes
			if (updatedSchema != null)
			{
				_setSchema(updatedSchema);

				// Broadcast the updated schema to the frontend
				_ = _communicationHandler.BroadcastSchemaUpdate(updatedSchema);
			}

			// Refresh the Grasshopper canvas to show updated nicknames
			var changedObjects = new List<IGH_ActiveObject>();
			foreach (var change in changes)
			{
				if (Guid.TryParse(change.ParamId, out var paramGuid))
				{
					var docObj = document.FindObject(paramGuid, false);
					if (docObj is IGH_ActiveObject activeObj)
					{
						changedObjects.Add(activeObj);
					}
				}
			}

			GHDocumentMutator.RefreshObjectsOnCanvas(document, changedObjects);

			// Schedule a solution to update the component (for toGH changes)
			GHDocumentMutator.ScheduleComponentExpire(document, _component, true);

			_ = _communicationHandler.BroadcastSyncApplied(true);
			_component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Sync changes applied successfully");
		}
		catch (Exception ex)
		{
			Logger.Error($"[BridgeCommunicationService] Error applying sync changes: {ex.Message}", ex);
			_ = _communicationHandler.BroadcastSyncApplied(false, ex.Message);
			_component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error applying sync changes: {ex.Message}");
		}
	}
}
