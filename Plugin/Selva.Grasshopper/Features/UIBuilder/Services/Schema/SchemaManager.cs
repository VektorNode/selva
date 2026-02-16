using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Selva.Core.Models;
using Selva.Grasshopper.Features.ComputeIO.Components;
using Selva.Grasshopper.Features.UIBuilder.Helpers;
using Selva.Grasshopper.Utilities.Helpers;

namespace Selva.Grasshopper.Features.UIBuilder.Services.Schema;

/// <summary>
///   Manages parameter scanning and schema validation
/// </summary>
public class SchemaManager
{
	private readonly Dictionary<Guid, ParameterMetadataSnapshot> _metadataCache = new();

	private readonly string _sessionId;

	public SchemaManager(string sessionId)
	{
		_sessionId = sessionId;
	}

	/// <summary>
	///   Scan document and return available parameters (inputs and outputs)
	/// </summary>
	public DiscoveredParameters ScanParameters(GH_Document document, GH_Component uiBridge)
	{
		// Scan for all contextual parameters (inputs only)
		var allParams = document.Objects
			.OfType<IGH_ContextualParameter>()
			.ToList();

		var availableParameters = new DiscoveredParameters
		{
			SessionId = _sessionId,
			Timestamp = DateTime.UtcNow,
			Inputs = new List<DiscoveredInput>(),
			Outputs = ScanOutputs(document)
		};

		foreach (var param in allParams)
		{
			var docObj = param as IGH_DocumentObject;
			if (docObj == null) continue;

			var ghParam = param as IGH_Param;
			var paramType = GetParameterTypeName(param);

			//Get prompt from IGH_ContextualParameter, but fall back to description if not set (some components don't set prompt)
			var availableParam = new DiscoveredInput
			{
				Id = docObj.InstanceGuid,
				Name = docObj.Name, // Keep for DiscoveredInput (used during builder phase)
				Nickname = docObj.NickName,
				Description = param.Prompt ?? "",
				Type = paramType,
				Default = null, // Will be set below based on parameter type
				AtLeast = param.AtLeast,
				AtMost = param.AtMost
			};

			// Handle ValueList parameters specially
			if (param is GetValueListParameter valueListParameter)
				try
				{
					// Extract the options dictionary from the ValueList
					var rawValues = valueListParameter.Values;
					if (rawValues is IDictionary idict)
					{
						var dict = new Dictionary<string, object>();
						foreach (DictionaryEntry de in idict)
						{
							var key = de.Key?.ToString() ?? string.Empty;
							dict[key] = de.Value;
						}

						availableParam.Options = dict;
					}

					var selectedValue = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable();
					if (selectedValue != null && availableParam.Options != null)
					{
						foreach (var kvp in availableParam.Options)
							if (kvp.Value?.ToString() == selectedValue?.ToString())
							{
								availableParam.Default = kvp.Key;
								break;
							}

						if (availableParam.Default == null && availableParam.Options.Count > 0)
							availableParam.Default = availableParam.Options.Keys.First();
					}
				}
				catch
				{
					// ignored
				}
			else
				availableParam.Default = ghParam?.VolatileData.AllData(true).FirstOrDefault()
					?.ScriptVariable(); //TODO: properly handle tree inputs (not a priority for now)

			try
			{
				var treeAccessProp = param.GetType().GetProperty("TreeAccess");
				if (treeAccessProp != null) availableParam.TreeAccess = Convert.ToBoolean(treeAccessProp.GetValue(param, null));
			}
			catch
			{
				// ignored
			}

			ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, availableParam);
			availableParameters.Inputs.Add(availableParam);
		}

		// ValidateAndReportDuplicates(availableParameters, uiBridge);
		return availableParameters;
	}

	/// <summary>
	///   Scan document and return available outputs (separate from parameters)
	/// </summary>
	public List<DiscoveredOutput> ScanOutputs(GH_Document document)
	{
		var outputs = new List<DiscoveredOutput>();

		// Scan for context output components (print, bake)
		var contextOutputs = document.Objects
			.Where(ParameterTypeHelper.IsContextOutputComponent)
			.ToList();

		foreach (var output in contextOutputs)
		{
			var outputComponent = output as GH_Component;
			if (outputComponent == null) continue;

			// Determine output display type based on component content
			// Try to parse if the content is numeric (for Print components)
			var displayType = "text"; // Default for Print components

			// For Print components, try to detect if output is numeric
			if (output.Name.IndexOf("Print", StringComparison.OrdinalIgnoreCase) >= 0)
				// Check if we can infer numeric output (simplified - in real scenario would need input analysis)
				displayType = "text"; // Keep as text by default, can be enhanced based on actual output

			var param = outputComponent.Params.Input[0];
			var paramName = param != null ? param.NickName : "Output";

			outputs.Add(new DiscoveredOutput
			{
				Id = output.InstanceGuid,
				Nickname = paramName,
				Description = "", // Component descriptions are informational only, not user-editable
				Type = displayType
			});
		}

		// Scan for ContextBake components that have FileData (file downloads)
		var (_, fileOutputs) = ParameterTypeHelper.DetectDownloadableOutputs(document);
		foreach (var fileOutput in fileOutputs)
			outputs.Add(new DiscoveredOutput
			{
				Id = fileOutput.Id,
				Nickname = fileOutput.Nickname,
				Description = "", // Component descriptions are informational only, not user-editable
				Type = "file"
			});

		return outputs;
	}

	/// <summary>
	///   Validate no duplicate parameter names
	/// </summary>
	public List<string> ValidateDuplicateInputs(DiscoveredParameters parameters)
	{
		return parameters.Inputs
			.GroupBy(p => p.Nickname)
			.Where(g => g.Count() > 1)
			.Select(g => g.Key)
			.ToList();
	}

	/// <summary>
	///   Validate for duplicate output names
	/// </summary>
	public List<string> ValidateDuplicateOutputs(DiscoveredParameters parameters)
	{
		if (parameters?.Outputs == null) return new List<string>();

		return parameters.Outputs
			.GroupBy(o => o.Nickname, StringComparer.OrdinalIgnoreCase)
			.Where(g => g.Count() > 1)
			.Select(g => g.Key)
			.ToList();
	}

	/// <summary>
	///   Validate schema against current document - removes references to missing parameters
	///   Wrapper for ValidateSchemaAndTrackChanges without tracking
	/// </summary>
	public UISchema ValidateSchema(UISchema schema, GH_Document document)
	{
		return ValidateSchemaAndTrackChanges(schema, document, false).Schema;
	}

	/// <summary>
	///   Synchronize schema metadata with current Grasshopper document state.
	///   Currently disabled - all metadata updates are controlled explicitly via the Sync dialog.
	///   Should be called before saving the schema and after loading it from file.
	/// </summary>
	public void SynchronizeSchemaMetadata(UISchema schema, GH_Document document)
	{
		if (schema == null || document == null) return;

		// IMPORTANT: Do NOT auto-sync nicknames or descriptions - user controls this explicitly via the Sync dialog
		// All metadata changes should go through the Sync dialog for explicit user control
	}

	/// <summary>
	///   Validate schema and optionally track what changed (removed parameters)
	///   Optimized to cache FindObject results and avoid redundant lookups
	/// </summary>
	public (UISchema Schema, List<Guid> RemovedIds) ValidateSchemaAndTrackChanges(
		UISchema schema,
		GH_Document document,
		bool trackChanges = true)
	{
		if (schema == null) return (null, new List<Guid>());

		var removedIds = trackChanges ? new List<Guid>() : null;

		// Build cache of existing IDs with a single scan (avoids N*FindObject calls)
		var allIds = new HashSet<Guid>();
		allIds.UnionWith(schema.Inputs.Select(i => i.Id));
		allIds.UnionWith(schema.Outputs.Select(o => o.Id));

		if (schema.Layout is TabbedLayoutConfig tabbed)
		{
			if (tabbed.Tabs != null)
				foreach (var tab in tabbed.Tabs)
				foreach (var group in tab.Groups)
					allIds.UnionWith(group.Items.Select(item => item.ParamId));
		}
		else if (schema.Layout is FlatLayoutConfig flat)
		{
			if (flat.Groups != null)
				foreach (var group in flat.Groups)
					allIds.UnionWith(group.Items.Select(item => item.ParamId));
		}

		// Single pass: check which IDs actually exist in document
		var existingIds = new HashSet<Guid>();
		foreach (var id in allIds)
			if (document.FindObject(id, false) != null)
				existingIds.Add(id);

		// Remove inputs that don't exist
		var inputsToRemove = schema.Inputs.Where(input => !existingIds.Contains(input.Id)).ToList();
		if (trackChanges) removedIds.AddRange(inputsToRemove.Select(i => i.Id));

		schema.Inputs.RemoveAll(input => inputsToRemove.Contains(input));

		// Remove outputs that don't exist
		var outputsToRemove = schema.Outputs.Where(output => !existingIds.Contains(output.Id)).ToList();
		if (trackChanges) removedIds.AddRange(outputsToRemove.Select(o => o.Id));

		schema.Outputs.RemoveAll(output => outputsToRemove.Contains(output));

		// Remove layout items that don't exist
		if (schema.Layout is TabbedLayoutConfig tabbedLayout)
		{
			if (tabbedLayout.Tabs != null)
			{
				foreach (var tab in tabbedLayout.Tabs)
				{
					foreach (var group in tab.Groups) group.Items.RemoveAll(item => !existingIds.Contains(item.ParamId));

					tab.Groups.RemoveAll(g => g.Items.Count == 0);
				}

				tabbedLayout.Tabs.RemoveAll(t => t.Groups.Count == 0);
			}
		}
		else if (schema.Layout is FlatLayoutConfig flatLayout)
		{
			if (flatLayout.Groups != null)
			{
				foreach (var group in flatLayout.Groups) group.Items.RemoveAll(item => !existingIds.Contains(item.ParamId));

				flatLayout.Groups.RemoveAll(g => g.Items.Count == 0);
			}
		}

		return (schema, removedIds ?? new List<Guid>());
	}

	/// <summary>
	///   Get parameter type name from contextual parameter
	/// </summary>
	private string GetParameterTypeName(IGH_ContextualParameter contextParam)
	{
		if (contextParam is IGH_Param param) return GetParameterTypeNameFromParam(param);

		return "generic";
	}

	/// <summary>
	///   Map Grasshopper parameter type to Compute-compatible type name using dictionary
	/// </summary>
	private string GetParameterTypeNameFromParam(IGH_Param param)
	{
		if (param == null) return "generic";

		var typeName = param.GetType().Name;

		//Will make proper use of this in the future
		var typeKeywords = new Dictionary<string, string>
		{
			{ "GetNumberParameter", "number" },
			{ "Slider", "number" },
			{ "ValueList", "valueList" },
			{ "GetFile", "file" },
			{ "Integer", "integer" },
			{ "Boolean", "boolean" },
			{ "Toggle", "boolean" },
			{ "String", "text" },
			{ "Text", "text" },
			{ "Panel", "text" },
			{ "Point", "point" },
			{ "Vector", "vector" },
			{ "Plane", "plane" },
			{ "Line", "line" },
			{ "Circle", "circle" },
			{ "Rectangle", "rectangle" },
			{ "Box", "box" },
			{ "Curve", "curve" },
			{ "Surface", "surface" },
			{ "Brep", "brep" },
			{ "Mesh", "mesh" },
			{ "SubD", "subd" },
			{ "Geometry", "geometry" }
		};

		foreach (var kvp in typeKeywords)
			if (typeName.Contains(kvp.Key))
				return kvp.Value;

		return "generic";
	}

	/// <summary>
	///   Detect metadata changes in parameters since last scan.
	///   Returns DiscoveredParameters with changed metadata and also applies changes to the schema.
	/// </summary>
	public DiscoveredParameters DetectMetadataChanges(GH_Document document, UISchema schema)
	{
		var changes = new DiscoveredParameters
		{
			SessionId = _sessionId,
			Timestamp = DateTime.UtcNow,
			Inputs = new List<DiscoveredInput>(),
			Outputs = new List<DiscoveredOutput>()
		};

		if (schema == null) return changes;

		// Check input parameters
		foreach (var inputParam in schema.Inputs)
		{
			var docObj = document.FindObject(inputParam.Id, false);
			if (docObj == null) continue;

			var currentSnapshot = CreateParameterSnapshot(docObj);
			if (currentSnapshot == null) continue;

			if (_metadataCache.TryGetValue(inputParam.Id, out var previousSnapshot))
			{
				if (!currentSnapshot.Equals(previousSnapshot))
				{
					// Metadata changed - create updated AvailableInput
					var updatedParam = CreateAvailableInputFromSnapshot(currentSnapshot, inputParam.Id);
					changes.Inputs.Add(updatedParam);

					// Update cache only when changed
					_metadataCache[inputParam.Id] = currentSnapshot;
				}
			}
			else
			{
				// New parameter - add to cache
				_metadataCache[inputParam.Id] = currentSnapshot;
			}
		}

		foreach (var outputParam in schema.Outputs)
		{
			var docObj = document.FindObject(outputParam.Id, false);
			if (docObj == null) continue;

			var currentSnapshot = CreateParameterSnapshot(docObj);
			if (currentSnapshot == null) continue;

			if (_metadataCache.TryGetValue(outputParam.Id, out var previousSnapshot))
			{
				if (!currentSnapshot.Equals(previousSnapshot))
				{
					var updatedParam = CreateAvailableOutputFromSnapshot(currentSnapshot, outputParam.Id);
					changes.Outputs.Add(updatedParam);

					// Update cache only when changed
					_metadataCache[outputParam.Id] = currentSnapshot;
				}
			}
			else
			{
				// New output - add to cache
				_metadataCache[outputParam.Id] = currentSnapshot;
			}
		}

		if (changes.Inputs.Count > 0 || changes.Outputs.Count > 0) ApplyMetadataChangesToSchema(schema, changes);

		return changes;
	}

	/// <summary>
	///   Apply detected metadata changes to the schema.
	///   Updates layout item configs (min/max/stepSize for numbers, options for dropdowns).
	///   Note: Does NOT update layout displayNames - those are user-controlled in the UI.
	/// </summary>
	public void ApplyMetadataChangesToSchema(UISchema schema, DiscoveredParameters changes)
	{
		if (schema?.Layout == null || changes == null) return;

		if (changes.Inputs.Count == 0 && changes.Outputs.Count == 0) return;

		var allItems = GetAllLayoutItems(schema.Layout);

		foreach (var change in changes.Inputs)
		{
			// Find and update the layout item for this parameter
			foreach (var item in allItems)
			{
				if (item.ParamId != change.Id) continue;

				switch (item)
				{
					case InputNumberLayoutItem numberItem:
						numberItem.Config ??= new NumberWidgetConfig();
						numberItem.Config.Minimum = change.Minimum;
						numberItem.Config.Maximum = change.Maximum;
						numberItem.Config.StepSize = change.StepSize;
						break;

					case InputDropdownLayoutItem dropdownItem:
						dropdownItem.Config ??= new DropdownWidgetConfig();
						dropdownItem.Config.Options = change.Options;
						break;
				}

				// Update description but preserve displayName (user-controlled in UI)
				item.Description = change.Description;
			}

			var inputParam = schema.Inputs.FirstOrDefault(i => i.Id == change.Id);
			if (inputParam != null)
			{
				inputParam.Nickname = change.Nickname;
				inputParam.Description = change.Description;
			}
		}

		// Process output changes
		foreach (var change in changes.Outputs)
		{
			// Update description in layout items but preserve displayName (user-controlled in UI)
			foreach (var item in allItems)
			{
				if (item.ParamId != change.Id) continue;

				item.Description = change.Description;
			}

			// Also update the Outputs list
			var outputParam = schema.Outputs.FirstOrDefault(o => o.Id == change.Id);
			if (outputParam != null)
			{
				outputParam.Nickname = change.Nickname;
				outputParam.Description = change.Description;
			}
		}
	}

	/// <summary>
	///   Create a snapshot of parameter metadata for comparison
	/// </summary>
	private ParameterMetadataSnapshot CreateParameterSnapshot(IGH_DocumentObject docObj)
	{
		if (docObj == null) return null;

		var param = docObj as IGH_ContextualParameter;
		var ghParam = docObj as IGH_Param;

		var snapshot = new ParameterMetadataSnapshot
		{
			Id = docObj.InstanceGuid,
			Nickname = docObj.NickName,
			Description = param.Prompt ?? ""
		};

		// Extract numeric constraints if applicable
		if (param != null && ghParam != null)
		{
			var availableParam = new DiscoveredInput { Id = docObj.InstanceGuid };
			ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, availableParam);

			snapshot.Minimum = availableParam.Minimum;
			snapshot.Maximum = availableParam.Maximum;
			snapshot.StepSize = availableParam.StepSize;
		}

		// Extract ValueList options if applicable
		if (docObj is GetValueListParameter valueListParam) snapshot.Options = valueListParam.Values;

		return snapshot;
	}

	/// <summary>
	///   Create an DiscoveredInput from a metadata snapshot
	/// </summary>
	private DiscoveredInput CreateAvailableInputFromSnapshot(
		ParameterMetadataSnapshot snapshot,
		Guid id)
	{
		var param = new DiscoveredInput
		{
			Id = id,
			Nickname = snapshot.Nickname,
			Description = snapshot.Description,
			Minimum = snapshot.Minimum,
			Maximum = snapshot.Maximum,
			StepSize = snapshot.StepSize
		};

		// Convert Options to the expected format
		if (snapshot.Options != null)
			param.Options = snapshot.Options.ToDictionary(kvp => kvp.Key, kvp => (object)kvp.Value);

		return param;
	}

	/// <summary>
	///   Create an DiscoveredOutput from a metadata snapshot
	/// </summary>
	private DiscoveredOutput CreateAvailableOutputFromSnapshot(
		ParameterMetadataSnapshot snapshot,
		Guid id)
	{
		var param = new DiscoveredOutput
		{
			Id = id,
			Nickname = snapshot.Nickname,
			Description = snapshot.Description,
			Type = "text" // Default to text output
		};

		return param;
	}

	/// <summary>
	///   Clear metadata cache (e.g., when schema is disabled)
	/// </summary>
	public void ClearMetadataCache()
	{
		_metadataCache.Clear();
	}

	/// <summary>
	///   Returns all layout items from either a tabbed or flat layout.
	///   Returns an empty sequence if the layout is null or has no groups.
	/// </summary>
	private static IEnumerable<LayoutItemBase> GetAllLayoutItems(LayoutConfigBase layout)
	{
		if (layout is TabbedLayoutConfig tabbedLayout && tabbedLayout.Tabs != null)
			return tabbedLayout.Tabs.SelectMany(t => t.Groups).SelectMany(g => g.Items);

		if (layout is FlatLayoutConfig flatLayout && flatLayout.Groups != null)
			return flatLayout.Groups.SelectMany(g => g.Items);

		return Enumerable.Empty<LayoutItemBase>();
	}

	/// <summary>
	///   Compute a diff between current Grasshopper state and schema state
	///   Returns changes that would go in each direction (GH→Schema, Schema→GH)
	///   For inputs: Syncs nickname only (GH parameter ↔ schema)
	///   For outputs: Syncs GH component's input parameter nickname ↔ layout displayName (also updates schema output nickname)
	///   Note: Descriptions are not synced - they are user-controlled in the UI.
	///   Note: Min/max/stepSize come from connected sliders and are not synced here.
	/// </summary>
	public static SyncDiff ComputeSyncDiff(UISchema schema, GH_Document document)
	{
		var diff = new SyncDiff();

		if (schema == null || document == null)
			return diff;

		// Get all layout items to find displayNames
		var allItems = GetAllLayoutItems(schema.Layout);

		// Compare inputs - sync GH nickname with layout displayName (and schema input nickname)
		if (schema.Inputs != null)
		{
			foreach (var input in schema.Inputs)
			{
				var docObj = document.FindObject(input.Id, false);
				if (docObj == null) continue;

				// Use current GH nickname for display purposes
				var currentGHName = docObj.NickName;

				// Find the layout item to get the displayName (user-controlled UI label)
				var layoutItem = allItems.FirstOrDefault(item => item.ParamId == input.Id);
				var layoutDisplayName = layoutItem?.DisplayName ?? input.Nickname;

				// Compare GH nickname with layout displayName
				if (currentGHName != layoutDisplayName)
				{
					// GH → Schema: Apply GH nickname to layout displayName (and schema nickname)
					diff.FromGH.Add(new SyncChange
					{
						ParamId = input.Id.ToString(),
						ParamNickname = currentGHName,
						Field = "nickname",
						GHValue = currentGHName,
						SchemaValue = layoutDisplayName,
						Direction = SyncDirection.FromGH
					});

					// Schema → GH: Apply layout displayName to GH nickname (and schema nickname)
					diff.ToGH.Add(new SyncChange
					{
						ParamId = input.Id.ToString(),
						ParamNickname = currentGHName,
						Field = "nickname",
						SchemaValue = layoutDisplayName,
						GHValue = currentGHName,
						Direction = SyncDirection.ToGH
					});
				}
			}
		}

		// Compare outputs (nickname only - components don't typically have descriptions in GH)
		// Note: For output components, we sync between GH input parameter nickname and layout displayName
		if (schema.Outputs != null)
		{
			foreach (var output in schema.Outputs)
			{
				var docObj = document.FindObject(output.Id, false);
				if (docObj == null) continue;

				// For output components, get the first input parameter (that's what we sync)
				var component = docObj as GH_Component;
				if (component == null || component.Params.Input.Count == 0) continue;

				var inputParam = component.Params.Input[0];
				if (inputParam == null) continue;

				// Find the layout item to get the displayName (user-controlled UI label)
				var layoutItem = allItems.FirstOrDefault(item => item.ParamId == output.Id);
				var layoutDisplayName = layoutItem?.DisplayName ?? output.Nickname;

				// Use the input parameter's current nickname for display purposes
				var currentGHName = inputParam.NickName;

				// Compare GH parameter nickname with layout displayName
				if (currentGHName != layoutDisplayName)
				{
					// GH → Schema: Apply GH nickname to layout displayName (and schema nickname)
					diff.FromGH.Add(new SyncChange
					{
						ParamId = output.Id.ToString(),
						ParamNickname = currentGHName,
						Field = "nickname",
						GHValue = currentGHName,
						SchemaValue = layoutDisplayName,
						Direction = SyncDirection.FromGH
					});

					// Schema → GH: Apply layout displayName to GH nickname (and schema nickname)
					diff.ToGH.Add(new SyncChange
					{
						ParamId = output.Id.ToString(),
						ParamNickname = currentGHName,
						Field = "nickname",
						SchemaValue = layoutDisplayName,
						GHValue = currentGHName,
						Direction = SyncDirection.ToGH
					});
				}
			}
		}

		return diff;
	}

	/// <summary>
	///   Apply selected sync changes to both Grasshopper document and schema
	///   For inputs: Syncs GH nickname ↔ layout displayName (also updates schema input nickname)
	///   For outputs: Syncs GH component's input parameter nickname ↔ layout displayName (also updates schema output nickname)
	///   Returns the updated schema if any "fromGH" changes were applied
	/// </summary>
	public static UISchema ApplySyncChanges(List<SyncChange> changes, GH_Document document, UISchema schema)
	{
		if (changes == null || document == null || schema == null) return schema;

		var schemaModified = false;
		var allLayoutItems = GetAllLayoutItems(schema.Layout);

		foreach (var change in changes)
		{
			if (!Guid.TryParse(change.ParamId, out var paramGuid)) continue;

			try
			{
				var docObj = document.FindObject(paramGuid, false);
				if (docObj == null) continue;

				if (change.Direction == SyncDirection.ToGH)
					schemaModified |= ApplyToGH(change, paramGuid, docObj, schema);
				else if (change.Direction == SyncDirection.FromGH)
					schemaModified |= ApplyFromGH(change, paramGuid, docObj, schema, allLayoutItems);
			}
			catch (Exception ex)
			{
				Logger.Warn($"Error applying sync change to parameter {change.ParamNickname}: {ex.Message}");
			}
		}

		return schemaModified ? schema : null;
	}

	/// <summary>
	///   Apply a "toGH" sync change (schema value to Grasshopper)
	/// </summary>
	private static bool ApplyToGH(SyncChange change, Guid paramGuid, IGH_DocumentObject docObj, UISchema schema)
	{
		var isInput = schema.Inputs?.Any(i => i.Id == paramGuid) ?? false;
		var isOutput = schema.Outputs?.Any(o => o.Id == paramGuid) ?? false;

		if (isInput && change.Field == "nickname" && change.SchemaValue is string displayName)
		{
			docObj.NickName = displayName;
			var input = schema.Inputs?.FirstOrDefault(i => i.Id == paramGuid);
			if (input != null)
			{
				input.Nickname = displayName;
				// After changing the nickname, we need to expire the solution to update the UI
				docObj.ExpireSolution(true);
				return true;
			}
		}

		if (isOutput && change.Field == "nickname" && change.SchemaValue is string outDisplayName)
		{
			var component = docObj as GH_Component;
			if (component != null && component.Params.Input.Count > 0)
			{
				var inputParam = component.Params.Input[0];
				if (inputParam != null)
				{
					inputParam.NickName = outDisplayName;
					var output = schema.Outputs?.FirstOrDefault(o => o.Id == paramGuid);
					if (output != null)
					{
						output.Nickname = outDisplayName;
						component.ExpireSolution(true);
						return true;
					}
				}

			}
		}

		return false;
	}

	/// <summary>
	///   Apply a "fromGH" sync change (Grasshopper value to schema)
	/// </summary>
	private static bool ApplyFromGH(SyncChange change, Guid paramGuid, IGH_DocumentObject docObj, UISchema schema,
		IEnumerable<LayoutItemBase> allLayoutItems)
	{
		if (change.Field != "nickname") return false;

		var modified = false;

		// Update schema inputs: apply GH nickname to both input nickname AND layout displayName
		var input = schema.Inputs?.FirstOrDefault(i => i.Id == paramGuid);
		if (input != null)
		{
			var ghNickname = docObj.NickName;
			input.Nickname = ghNickname;
			var layoutItem = allLayoutItems.FirstOrDefault(item => item.ParamId == paramGuid);
			if (layoutItem != null)
				layoutItem.DisplayName = ghNickname;
			modified = true;
		}

		// Update schema outputs: apply GH component's input parameter nickname to both output nickname AND layout displayName
		var output = schema.Outputs?.FirstOrDefault(o => o.Id == paramGuid);
		if (output != null)
		{
			var component = docObj as GH_Component;
			if (component != null && component.Params.Input.Count > 0)
			{
				var inputParam = component.Params.Input[0];
				if (inputParam != null)
				{
					var ghNickname = inputParam.NickName;
					output.Nickname = ghNickname;
					var layoutItem = allLayoutItems.FirstOrDefault(item => item.ParamId == paramGuid);
					if (layoutItem != null)
						layoutItem.DisplayName = ghNickname;
					modified = true;
				}
			}
		}

		return modified;
	}
}

/// <summary>
///   Snapshot of parameter metadata for change detection
/// </summary>
internal class ParameterMetadataSnapshot
{
	public Guid Id { get; set; }
	public string Nickname { get; set; }
	public string Description { get; set; }
	public double? Minimum { get; set; }
	public double? Maximum { get; set; }
	public double? StepSize { get; set; }
	public Dictionary<string, string> Options { get; set; }

	public override bool Equals(object obj)
	{
		if (!(obj is ParameterMetadataSnapshot other)) return false;

		return Id == other.Id &&
		       Nickname == other.Nickname &&
		       Description == other.Description &&
		       Minimum == other.Minimum &&
		       Maximum == other.Maximum &&
		       StepSize == other.StepSize &&
		       OptionsEqual(Options, other.Options);
	}

	private static bool OptionsEqual(Dictionary<string, string> a, Dictionary<string, string> b)
	{
		if (a == null && b == null) return true;

		if (a == null || b == null) return false;

		if (a.Count != b.Count) return false;

		foreach (var kvp in a)
			if (!b.TryGetValue(kvp.Key, out var value) || value != kvp.Value)
				return false;

		return true;
	}

	public override int GetHashCode()
	{
		return Id.GetHashCode();
	}
}
