using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Selva.Core.Models;
using Selva.Grasshopper.Config;
using Selva.Grasshopper.Features.UIBuilder.Helpers;
using Selva.Grasshopper.Features.UIBuilder.Services.Communication;
using Selva.Grasshopper.Features.UIBuilder.Services.Events;
using Selva.Grasshopper.Features.UIBuilder.Services.Persistence;
using Selva.Grasshopper.Features.UIBuilder.Services.Schema;
using Selva.Grasshopper.Utilities.Helpers;

namespace Selva.Grasshopper.Features.UIBuilder.Services;

/// <summary>
/// Handles synchronization between Grasshopper document changes and UI schema state.
/// Subscribes to document events and coordinates schema validation, parameter updates, and broadcasts.
/// </summary>
public class DocumentSynchronizationService : IDisposable
{
	private readonly DocumentEventManager _eventManager;
	private readonly SchemaManager _schemaManager;
	private readonly CommunicationHandler _communicationHandler;
	private readonly SchemaCleanupService _cleanupService;

	private GH_Component _component;
	private GH_Document _currentDocument;
	private bool _disposed;

	// Callbacks to access component's schema/values (single source of truth)
	private Func<UISchema> _getSchema;
	private Func<Dictionary<string, object>> _getValues;
	private Action<UISchema> _setSchema;

	// Delegate for parameter deletion handling
	public event Action<List<Guid>, GH_Document> OnParameterDeletionRequired;

	public DocumentSynchronizationService(
		DocumentEventManager eventManager,
		SchemaManager schemaManager,
		CommunicationHandler communicationHandler,
		SchemaCleanupService cleanupService)
	{
		_eventManager = eventManager ?? throw new ArgumentNullException(nameof(eventManager));
		_schemaManager = schemaManager ?? throw new ArgumentNullException(nameof(schemaManager));
		_communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
		_cleanupService = cleanupService ?? throw new ArgumentNullException(nameof(cleanupService));
	}

	/// <summary>
	/// Initialize the service and wire up document event handlers.
	/// </summary>
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

		// Wire up document event handlers
		_eventManager.ParametersChanged += HandleParametersChanged;
		_eventManager.MetadataChanged += HandleMetadataChanged;
	}

	public void Dispose()
	{
		if (_disposed) return;

		// Unwire event handlers
		if (_eventManager != null)
		{
			_eventManager.ParametersChanged -= HandleParametersChanged;
			_eventManager.MetadataChanged -= HandleMetadataChanged;
		}

		_disposed = true;
	}

	private void HandleParametersChanged(object sender, ParametersChangedEventArgs e)
	{
		try
		{
			var schema = _getSchema();
			var currentParams = GetCurrentAvailableParameters(e.Document);

			// If no schema exists, broadcast available parameters
			if (schema == null)
			{
				if (currentParams.Inputs.Count > 0 || currentParams.Outputs.Count > 0)
				{
					_ = _communicationHandler.BroadcastMessage("parametersAdded", new { availableParams = currentParams })
						.ContinueWith(t =>
						{
							if (t.IsFaulted)
							{
								Logger.Error("Failed to broadcast parametersAdded", t.Exception);
								_component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Failed to broadcast parametersAdded");
							}
						});

					_component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
						$"Parameter(s)/Output(s) detected: {currentParams.Inputs.Count} params, {currentParams.Outputs.Count} outputs. Check web UI.");
				}

				return;
			}

			// Validate schema and track changes
			var (updatedSchema, removedIds) = _schemaManager.ValidateSchemaAndTrackChanges(schema, e.Document);

			if (removedIds.Count > 0)
			{
				_setSchema(updatedSchema);
				OnParameterDeletionRequired?.Invoke(removedIds, e.Document);

				GHDocumentMutator.ScheduleComponentExpire(e.Document, _component, false);
			}
			else
			{
				// Check for new parameters
				var newParamIds = currentParams.Inputs
					.Where(p => !schema.Inputs.Any(i => i.Id == p.Id))
					.Select(p => p.Id)
					.ToList();

				var newOutputIds = currentParams.Outputs
					.Where(o => !schema.Outputs.Any(so => so.Id == o.Id))
					.Select(o => o.Id)
					.ToList();

				if (newParamIds.Count > 0 || newOutputIds.Count > 0)
				{
					_ = _communicationHandler.BroadcastMessage("parametersAdded", new { availableParams = currentParams })
						.ContinueWith(t =>
						{
							if (t.IsFaulted)
							{
								Logger.Error("Failed to broadcast parametersAdded", t.Exception);
								_component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Failed to broadcast parametersAdded");
							}
						});

					_component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
						$"New items added: {newParamIds.Count} param(s), {newOutputIds.Count} output(s). Check web UI.");
				}
			}
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
			if ((e.Changes.Inputs.Count > 0 || e.Changes.Outputs.Count > 0) && _currentDocument != null)
			{
				_currentDocument.Modified();

				if (e.RequiresRecalculation)
				{
					_component?.ExpireSolution(false);
					_component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Source parameter changed - recalculating");
				}
			}
		}
		catch (Exception ex)
		{
			_component?.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error handling metadata changes: {ex.Message}");
		}
	}

	private DiscoveredParameters GetCurrentAvailableParameters(GH_Document document)
	{
		if (document == null || _schemaManager == null || _component == null)
		{
			return new DiscoveredParameters
			{
				SessionId = "",
				Inputs = [],
				Outputs = []
			};
		}

		return _schemaManager.ScanParameters(document, _component);
	}
}

