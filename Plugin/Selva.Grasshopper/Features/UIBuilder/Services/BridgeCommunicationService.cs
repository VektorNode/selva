using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Rhino;
using Selva.Core.Models;
using Selva.Grasshopper.Config;
using Selva.Grasshopper.Features.UIBuilder.Helpers;
using Selva.Grasshopper.Features.UIBuilder.Services.Communication;
using Selva.Grasshopper.Features.UIBuilder.Services.Persistence;
using Selva.Grasshopper.Features.UIBuilder.Services.Schema;
using Selva.Grasshopper.Features.UIBuilder.Services.State;
using Selva.Grasshopper.Features.UIBuilder.Services.Values;
using Selva.Grasshopper.Utilities.Guards;
using Selva.Grasshopper.Utilities.Helpers;

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
	private readonly SchemaCleanupService _cleanupService;
	private readonly Version _pluginVersion;

	private UISchema _currentSchema;
	private Dictionary<string, object> _currentValues;
	private GH_Component _component;
	private bool _disposed;

	public BridgeCommunicationService(
		CommunicationHandler communicationHandler,
		SchemaManager schemaManager,
		ValueApplicator valueApplicator,
		ValueCollector valueCollector,
		ComponentStateManager stateManager,
		SchemaCleanupService cleanupService,
		Version pluginVersion)
	{
		_communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
		_schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
		_valueApplicator = valueApplicator ?? throw new ArgumentNullException(nameof(valueApplicator));
		_valueCollector = valueCollector ?? throw new ArgumentNullException(nameof(valueCollector));
		_stateManager = stateManager ?? throw new ArgumentNullException(nameof(stateManager));
		_cleanupService = cleanupService ?? throw new ArgumentNullException(nameof(cleanupService));
		_pluginVersion = pluginVersion ?? throw new ArgumentNullException(nameof(pluginVersion));
	}

	/// <summary>
	/// Initialize the service and wire up event handlers.
	/// </summary>
	public void Initialize(GH_Component component, UISchema schema, Dictionary<string, object> values)
	{
		_component = component ?? throw new ArgumentNullException(nameof(component));
		_currentSchema = schema;
		_currentValues = values;

		// Wire up WebSocket event handlers
		_communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
		_communicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
		_communicationHandler.OnClientConnected += HandleClientConnected;
		_communicationHandler.OnSchemaSaveRequested += HandleSchemaSave;
	}

	/// <summary>
	/// Update the current schema reference.
	/// </summary>
	public void UpdateSchema(UISchema schema)
	{
		_currentSchema = schema;
	}

	/// <summary>
	/// Update the current values reference.
	/// </summary>
	public void UpdateValues(Dictionary<string, object> values)
	{
		_currentValues = values;
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
			if (!DocumentGuards.DocumentAndSchemaValid(document, _currentSchema, out _))
			{
				Logger.Warn("[BridgeCommunicationService] Document or schema invalid, skipping value update");
				BroadcastRuntimeMessageAsync("error", "Document or schema invalid");
				return;
			}

			var updated = _valueApplicator.ApplyValuesAndSchedule(document, _currentSchema, values,
				(level, msg) =>
				{
					_component.AddRuntimeMessage(level, msg);
					// Only broadcast errors and warnings, not info messages
					if (level == GH_RuntimeMessageLevel.Error || level == GH_RuntimeMessageLevel.Warning)
					{
						BroadcastRuntimeMessageAsync(ConvertMessageLevel(level), msg);
					}
				});

			if (updated > 0)
			{
				_currentValues = new Dictionary<string, object>(values);
			}
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

			var currentParams = GetCurrentAvailableParameters(document);
			var currentValues = _valueCollector.CollectInputValues(document, _currentSchema, _component.AddRuntimeMessage);

			var (validatedSchema, removedIds) = GetValidatedSchema(document);
			if (removedIds.Count > 0)
			{
				HandleParameterDeletion(removedIds, document);
			}

			// Create default schema if none exists
			var schemaToSend = validatedSchema ?? _currentSchema ?? CreateDefaultSchema(document);

			// Broadcast initial data
			_ = _communicationHandler.BroadcastInitialData(schemaToSend, currentParams, currentValues);

			// Trigger output broadcast after a small delay
			Task.Run(async () =>
			{
				await Task.Delay(100);
				// Note: EventManager.CollectAndBroadcastOutputs needs to be called from component
				// This is a limitation we'll need to address
			});
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

			// Suppress solving state updates during schema save
			_communicationHandler.SetSuppressSolvingStateUpdates(true, 1000);

			// Synchronize nicknames BEFORE saving
			_schemaManager.SynchronizeSchemaMetadata(schema, document);

			// Enrich schema with document metadata
			schema.ProjectFileName = document.Properties.ProjectFileName;
			schema.DocumentId = document.DocumentID;
			schema.PluginVersion = _pluginVersion.ToString();

			_currentSchema = _schemaManager.ValidateSchema(schema, document);
			_ = _communicationHandler.BroadcastSchemaSaved(true);

			// Schedule solution to update component
			document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, doc =>
			{
				_component.ExpireSolution(true);
			});

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

			var currentValues = _valueCollector.CollectInputValues(document, _currentSchema, _component.AddRuntimeMessage);
			_ = _communicationHandler.BroadcastCurrentValues(currentValues);
		}
		catch (Exception ex)
		{
			Logger.Error($"[BridgeCommunicationService] Error handling current values request: {ex.Message}", ex);
		}
	}

	private void HandleParameterDeletion(List<Guid> removedIds, GH_Document document)
	{
		_cleanupService.CleanupDeletedParameters(
			removedIds,
			_currentSchema,
			_valueApplicator,
			_currentValues,
			_communicationHandler,
			document,
			_component.AddRuntimeMessage
		);
	}

	private (UISchema schema, List<Guid> removedIds) GetValidatedSchema(GH_Document document)
	{
		if (document == null || _currentSchema == null || _schemaManager == null)
		{
			return (null, new List<Guid>());
		}

		return _schemaManager.ValidateSchemaAndTrackChanges(_currentSchema, document);
	}

	private DiscoveredParameters GetCurrentAvailableParameters(GH_Document document)
	{
		if (document == null || _schemaManager == null || _component == null)
		{
			return new DiscoveredParameters
			{
				SessionId = "",
				Inputs = new List<DiscoveredInput>(),
				Outputs = new List<DiscoveredOutput>()
			};
		}

		return _schemaManager.ScanParameters(document, _component);
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
				BackgroundColor = "#ffffff"
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
}
