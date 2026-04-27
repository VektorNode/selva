using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;
using Selva.Core.Models;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Manages parameter scanning, schema validation, and synchronization between
///     Grasshopper documents and UI schemas.
/// </summary>
public class SchemaManager
{
    #region Static Configuration

    /// <summary>
    ///     Keyword → type name mapping. Entries are checked via string.Contains against the GH type name.
    /// </summary>
    private static readonly Dictionary<string, string> ParameterTypeKeywords = new Dictionary<string, string>
    {
        { "GetNumberParameter", "number" },
        { "Slider", "number" },
        { "ValueList", "valueList" },
        { "GetFile", "file" },
        { "GetColor", "color" },
        { "Colour", "color" },
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

    /// <summary>
    ///     Cache resolved type names by exact CLR type to avoid repeated substring scans.
    ///     Note: Not thread-safe. If GH ever processes documents on multiple threads,
    ///     consider switching to ConcurrentDictionary.
    /// </summary>
    private static readonly Dictionary<Type, string> TypeNameCache = new Dictionary<Type, string>();

    #endregion

    #region Instance State

    private readonly Dictionary<Guid, ParameterMetadataSnapshot> _metadataCache =
        new Dictionary<Guid, ParameterMetadataSnapshot>();

    private readonly string _sessionId;

    public SchemaManager(string sessionId)
    {
        _sessionId = sessionId;
    }

    #endregion

    #region Parameter Scanning

    /// <summary>
    ///     Scan the document and return all discoverable inputs and outputs in a single pass.
    ///     When <paramref name="ownerComponent" /> is provided, only ContextBake/ContextPrint
    ///     components wired to its "Schema" output are included.
    /// </summary>
    public DiscoveredParameters ScanParameters(GH_Document document, GH_Component ownerComponent = null)
    {
        var result = new DiscoveredParameters
        {
            SessionId = _sessionId,
            Timestamp = DateTime.UtcNow,
            Inputs = new List<DiscoveredInput>(),
            Outputs = new List<DiscoveredOutput>()
        };

        var scopeFilter = BuildScopeFilter(document, ownerComponent);
        var (contextParams, printComponents, bakeComponents) = ClassifyDocumentObjects(document, scopeFilter);

        CollectPrintOutputs(printComponents, result.Outputs);
        CollectFileOutputs(bakeComponents, result.Outputs);
        CollectChartOutputs(bakeComponents, result.Outputs);
        CollectInputs(contextParams, result.Inputs);

        return result;
    }

    /// <summary>
    ///     Determines which context components are "in scope" for the given owner.
    ///     Returns null when no owner is specified (all components are in scope).
    /// </summary>
    private static HashSet<Guid> BuildScopeFilter(GH_Document document, GH_Component ownerComponent)
    {
        if (ownerComponent == null)
        {
            return null;
        }

        var inScope = new HashSet<Guid>();

        foreach (var obj in document.Objects)
        {
            if (obj is not GH_Component c)
            {
                continue;
            }

            var isBake = ParameterTypeHelper.IsContextBakeComponent(obj);
            var isPrint = ParameterTypeHelper.IsContextOutputComponent(obj);
            if (!isBake && !isPrint)
            {
                continue;
            }

            // Context Print components use GH's contextual mechanism (not wires) so they are always in scope
            if (isPrint ||
                ParameterTypeHelper.IsWiredToOwner(c, ownerComponent.InstanceGuid) ||
                ParameterTypeHelper.IsFileOutputBakeComponent(c) ||
                ParameterTypeHelper.IsChartOutputBakeComponent(c))
            {
                inScope.Add(c.InstanceGuid);
            }
        }

        return inScope;
    }

    /// <summary>
    ///     Single pass over document objects — classify into inputs, print outputs, and bake outputs.
    /// </summary>
    private static (List<IGH_ContextualParameter> Inputs, List<GH_Component> Prints, List<GH_Component> Bakes)
        ClassifyDocumentObjects(GH_Document document, HashSet<Guid> scopeFilter)
    {
        var inputs = new List<IGH_ContextualParameter>();
        var prints = new List<GH_Component>();
        var bakes = new List<GH_Component>();

        foreach (var obj in document.Objects)
        {
            if (obj is IGH_ContextualParameter cp)
            {
                inputs.Add(cp);
                continue;
            }

            if (obj is not GH_Component c)
            {
                continue;
            }

            if (ParameterTypeHelper.IsContextOutputComponent(obj))
            {
                if (scopeFilter == null || scopeFilter.Contains(c.InstanceGuid))
                {
                    prints.Add(c);
                }
            }
            else if (ParameterTypeHelper.IsContextBakeComponent(obj))
            {
                if (scopeFilter == null || scopeFilter.Contains(c.InstanceGuid))
                {
                    bakes.Add(c);
                }
            }
        }

        return (inputs, prints, bakes);
    }

    private static void CollectPrintOutputs(List<GH_Component> printComponents, List<DiscoveredOutput> outputs)
    {
        foreach (var c in printComponents)
        {
            var param = c.Params.Input.Count > 0 ? c.Params.Input[0] : null;
            outputs.Add(new DiscoveredOutput
            {
                Id = c.InstanceGuid,
                Nickname = param?.NickName ?? "Output",
                Description = "",
                Type = "text"
            });
        }
    }

    private static void CollectFileOutputs(List<GH_Component> bakeComponents, List<DiscoveredOutput> outputs)
    {
        foreach (var c in bakeComponents)
        {
            if (!ParameterTypeHelper.IsFileOutputBakeComponent(c))
            {
                continue;
            }

            outputs.Add(new DiscoveredOutput
            {
                Id = c.InstanceGuid,
                Nickname = c.Params.Input[0].NickName,
                Description = "",
                Type = "file"
            });
        }
    }

    private static void CollectChartOutputs(List<GH_Component> bakeComponents, List<DiscoveredOutput> outputs)
    {
        foreach (var c in bakeComponents)
        {
            if (!ParameterTypeHelper.IsChartOutputBakeComponent(c))
            {
                continue;
            }

            outputs.Add(new DiscoveredOutput
            {
                Id = c.InstanceGuid,
                Nickname = c.Params.Input[0].NickName,
                Description = "",
                Type = "chart"
            });
        }
    }

    private static void CollectInputs(List<IGH_ContextualParameter> contextParams, List<DiscoveredInput> inputs)
    {
        foreach (var param in contextParams)
        {
            if (param is not IGH_DocumentObject docObj)
            {
                continue;
            }

            var ghParam = param as IGH_Param;
            var input = new DiscoveredInput
            {
                Id = docObj.InstanceGuid,
                Name = docObj.Name,
                Nickname = docObj.NickName,
                Description = param.Prompt ?? "",
                Type = ResolveParameterTypeName(param),
                Default = null,
                AtLeast = param.AtLeast,
                AtMost = param.AtMost
            };

            PopulateInputDefault(param, ghParam, input);
            ExtractTreeAccess(param, input);
            ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, input);

            inputs.Add(input);
        }
    }

    /// <summary>
    ///     Populate the default value, handling ValueList parameters specially.
    /// </summary>
    private static void PopulateInputDefault(IGH_ContextualParameter param, IGH_Param ghParam, DiscoveredInput input)
    {
        if (param is GetValueListParameter valueList)
        {
            PopulateValueListDefault(valueList, ghParam, input);
            return;
        }

        // TODO: properly handle tree inputs (not a priority for now)
        input.Default = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable();
    }

    private static void PopulateValueListDefault(
        GetValueListParameter valueList, IGH_Param ghParam, DiscoveredInput input)
    {
        try
        {
            if (valueList.Values is IDictionary rawDict)
            {
                var options = new Dictionary<string, object>();
                foreach (DictionaryEntry entry in rawDict)
                {
                    options[entry.Key?.ToString() ?? string.Empty] = entry.Value;
                }

                input.Options = options;
            }

            var selectedValue = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable();
            if (selectedValue == null || input.Options == null)
            {
                return;
            }

            var selectedString = selectedValue.ToString();
            input.Default = input.Options
                .Where(kvp => kvp.Value?.ToString() == selectedString)
                .Select(kvp => (object)kvp.Key)
                .FirstOrDefault() ?? input.Options.Keys.FirstOrDefault();
        }
        catch
        {
            // Silently ignore ValueList extraction failures
        }
    }

    private static void ExtractTreeAccess(IGH_ContextualParameter param, DiscoveredInput input)
    {
        try
        {
            var prop = param.GetType().GetProperty("TreeAccess");
            if (prop != null)
            {
                input.TreeAccess = Convert.ToBoolean(prop.GetValue(param, null));
            }
        }
        catch
        {
            // Silently ignore reflection failures
        }
    }

    /// <summary>
    ///     Apply layout-item config flags that affect GH parameter behavior back onto the document.
    ///     Currently: when a dropdown layout item declares `displayAs = "checklist"`, the matching
    ///     GetValueListParameter is switched to list access so multi-selection flows downstream.
    /// </summary>
    public void ApplyParameterAccessFromSchema(UISchema schema, GH_Document document)
    {
        if (schema?.Layout == null || document == null)
        {
            return;
        }

        foreach (var item in GetAllLayoutItems(schema.Layout))
        {
            if (item is not InputDropdownLayoutItem dropdown || dropdown.Config == null)
            {
                continue;
            }

            var docObj = document.FindObject(dropdown.ParamId, false);
            if (docObj is not GetValueListParameter valueList)
            {
                continue;
            }

            var listAccess = string.Equals(dropdown.Config.DisplayAs, "checklist", StringComparison.OrdinalIgnoreCase);
            valueList.SetListAccess(listAccess);
        }
    }

    #endregion

    #region Schema Validation

    /// <summary>
    ///     Validate schema against the current document — removes references to missing parameters.
    /// </summary>
    public UISchema ValidateSchema(UISchema schema, GH_Document document)
    {
        ValidateSchemaAndTrackChanges(schema, document, out _);
        return schema;
    }

    /// <summary>
    ///     Reconcile schema nicknames directly against the current document state.
    ///     Used on startup/enable to fix any drift that occurred while Rhino was closed.
    ///     Unlike DetectMetadataChanges, this bypasses the snapshot cache and always reflects current GH state.
    ///     Returns true if any nicknames were updated.
    /// </summary>
    public bool SyncNicknamesFromDocument(UISchema schema, GH_Document document)
    {
        if (schema == null || document == null)
        {
            return false;
        }

        var changed = false;

        foreach (var input in schema.Inputs)
        {
            var docObj = document.FindObject(input.Id, false);
            if (docObj == null)
            {
                continue;
            }

            if (input.Nickname != docObj.NickName)
            {
                input.Nickname = docObj.NickName;
                changed = true;
            }
        }

        foreach (var output in schema.Outputs)
        {
            if (document.FindObject(output.Id, false) is not GH_Component component)
            {
                continue;
            }

            if (component.Params.Input.Count == 0)
            {
                continue;
            }

            var inputParam = component.Params.Input[0];
            if (inputParam == null)
            {
                continue;
            }

            if (output.Nickname != inputParam.NickName)
            {
                output.Nickname = inputParam.NickName;
                changed = true;
            }
        }

        // Also seed the metadata cache so the first UndoStateChanged after startup
        // has a baseline and doesn't incorrectly report everything as changed.
        if (changed)
        {
            ClearMetadataCache();
        }

        return changed;
    }

    /// <summary>
    ///     Validate schema and track which parameter IDs were removed.
    /// </summary>
    public (UISchema Schema, List<Guid> RemovedIds) ValidateSchemaAndTrackChanges(
        UISchema schema, GH_Document document)
    {
        ValidateSchemaAndTrackChanges(schema, document, out var removedIds);
        return (schema, removedIds);
    }

    private void ValidateSchemaAndTrackChanges(UISchema schema, GH_Document document, out List<Guid> removedIds)
    {
        if (schema == null)
        {
            removedIds = [];
            return;
        }

        var referencedIds = CollectAllReferencedIds(schema);
        var existingIds = ResolveExistingIds(referencedIds, document);
        removedIds = PurgeStaleReferences(schema, existingIds);
        MergeDiscoveredInputs(schema, document);
        MergeDiscoveredPrintOutputs(schema, document);
    }

    /// <summary>
    ///     Gather every parameter ID referenced anywhere in the schema.
    /// </summary>
    private static HashSet<Guid> CollectAllReferencedIds(UISchema schema)
    {
        var ids = new HashSet<Guid>();

        ids.UnionWith(schema.Inputs.Select(i => i.Id));
        ids.UnionWith(schema.Outputs.Select(o => o.Id));
        ids.UnionWith(GetAllLayoutItems(schema.Layout).Where(item => item.Type != "linebreak")
            .Select(item => item.ParamId));

        return ids;
    }

    /// <summary>
    ///     Check which of the given IDs actually exist in the document.
    /// </summary>
    private static HashSet<Guid> ResolveExistingIds(HashSet<Guid> candidates, GH_Document document)
    {
        var existing = new HashSet<Guid>();
        foreach (var id in candidates)
        {
            if (document.FindObject(id, false) != null)
            {
                existing.Add(id);
            }
        }

        return existing;
    }

    /// <summary>
    ///     Remove stale inputs, outputs, and layout items. Returns list of removed IDs.
    /// </summary>
    private static List<Guid> PurgeStaleReferences(UISchema schema, HashSet<Guid> existingIds)
    {
        var removed = new List<Guid>();

        removed.AddRange(schema.Inputs.Where(i => !existingIds.Contains(i.Id)).Select(i => i.Id));
        removed.AddRange(schema.Outputs.Where(o => !existingIds.Contains(o.Id)).Select(o => o.Id));

        // Use a set for O(1) removal checks instead of list.Contains (O(n))
        var removedSet = new HashSet<Guid>(removed);
        schema.Inputs.RemoveAll(i => removedSet.Contains(i.Id));
        schema.Outputs.RemoveAll(o => removedSet.Contains(o.Id));

        PurgeStaleLayoutItems(schema.Layout, existingIds);

        return removed;
    }

    /// <summary>
    ///     Remove layout items whose parameters no longer exist, cleaning up empty groups and tabs.
    ///     Note: This method must access the concrete layout types directly because it mutates
    ///     the group/tab collections (RemoveAll), which requires references to the actual lists.
    /// </summary>
    private static void PurgeStaleLayoutItems(LayoutConfigBase layout, HashSet<Guid> existingIds)
    {
        if (layout is TabbedLayoutConfig tabbed && tabbed.Tabs != null)
        {
            foreach (var tab in tabbed.Tabs)
            {
                foreach (var group in tab.Groups)
                {
                    group.Items.RemoveAll(item => item.Type != "linebreak" && !existingIds.Contains(item.ParamId));
                }

                tab.Groups.RemoveAll(g => g.Items.Count == 0);
            }

            tabbed.Tabs.RemoveAll(t => t.Groups.Count == 0);
        }
        else if (layout is FlatLayoutConfig flat && flat.Groups != null)
        {
            foreach (var group in flat.Groups)
            {
                group.Items.RemoveAll(item => item.Type != "linebreak" && !existingIds.Contains(item.ParamId));
            }

            flat.Groups.RemoveAll(g => g.Items.Count == 0);
        }
    }

    #endregion

    #region Metadata Change Detection

    /// <summary>
    ///     Ensures every contextual parameter in the document is tracked in schema.Inputs,
    ///     even if it has no layout item. Inputs already in the schema are left untouched;
    ///     only genuinely new parameters are appended.
    /// </summary>
    private static void MergeDiscoveredInputs(UISchema schema, GH_Document document)
    {
        if (document == null)
        {
            return;
        }

        var existingIds = new HashSet<Guid>(schema.Inputs.Select(i => i.Id));

        foreach (var obj in document.Objects)
        {
            if (obj is not IGH_ContextualParameter param)
            {
                continue;
            }

            if (obj is not IGH_DocumentObject docObj)
            {
                continue;
            }

            if (existingIds.Contains(docObj.InstanceGuid))
            {
                continue;
            }

            schema.Inputs.Add(new SchemaInput
            {
                Id = docObj.InstanceGuid,
                Nickname = docObj.NickName,
                ParamType = ResolveParameterTypeName(param),
                Description = param.Prompt ?? "",
                InputStructure = "item"
            });

            existingIds.Add(docObj.InstanceGuid);
        }
    }

    /// <summary>
    ///     After a solve, sync ContextBake outputs in the schema:
    ///     - Adds newly-qualifying bakes (file/chart now wired correctly)
    ///     - Removes bakes that are still on the canvas but no longer qualify (unwired)
    ///     Returns (addedIds, removedIds) so the caller can broadcast accordingly.
    /// </summary>
    public (List<Guid> Added, List<Guid> Removed) MergePostSolveBakeOutputs(UISchema schema, GH_Document document)
    {
        var added = new List<Guid>();
        var removed = new List<Guid>();
        if (schema == null || document == null)
        {
            return (added, removed);
        }

        // Build a map of all ContextBake components currently on the canvas
        var bakeComponents = new Dictionary<Guid, GH_Component>();
        foreach (var obj in document.Objects)
        {
            if (ParameterTypeHelper.IsContextBakeComponent(obj) && obj is GH_Component c)
            {
                bakeComponents[c.InstanceGuid] = c;
            }
        }

        // Remove existing schema outputs that are ContextBake but no longer qualify
        var toRemove = schema.Outputs
            .Where(o => bakeComponents.TryGetValue(o.Id, out var c)
                        && !ParameterTypeHelper.IsFileOutputBakeComponent(c)
                        && !ParameterTypeHelper.IsChartOutputBakeComponent(c))
            .Select(o => o.Id)
            .ToList();

        if (toRemove.Count > 0)
        {
            schema.Outputs.RemoveAll(o => toRemove.Contains(o.Id));
            removed.AddRange(toRemove);
        }

        // Add newly-qualifying bakes not yet in the schema
        var existingIds = new HashSet<Guid>(schema.Outputs.Select(o => o.Id));
        foreach (var kvp in bakeComponents)
        {
            if (existingIds.Contains(kvp.Key))
            {
                continue;
            }

            if (kvp.Value.Params.Input.Count == 0)
            {
                continue;
            }

            string type;
            if (ParameterTypeHelper.IsFileOutputBakeComponent(kvp.Value))
            {
                type = "file";
            }
            else if (ParameterTypeHelper.IsChartOutputBakeComponent(kvp.Value))
            {
                type = "chart";
            }
            else
            {
                continue;
            }

            schema.Outputs.Add(new SchemaOutput
            {
                Id = kvp.Key,
                Nickname = kvp.Value.Params.Input[0].NickName,
                Description = "",
                Type = type
            });

            existingIds.Add(kvp.Key);
            added.Add(kvp.Key);
        }

        return (added, removed);
    }

    /// <summary>
    ///     Auto-merge ContextPrint components into schema.Outputs (same as MergeDiscoveredInputs for inputs).
    ///     ContextBake is excluded — it needs a solve to determine what it's connected to.
    /// </summary>
    private static void MergeDiscoveredPrintOutputs(UISchema schema, GH_Document document)
    {
        if (document == null)
        {
            return;
        }

        var existingIds = new HashSet<Guid>(schema.Outputs.Select(o => o.Id));

        foreach (var obj in document.Objects)
        {
            if (!ParameterTypeHelper.IsContextOutputComponent(obj))
            {
                continue;
            }

            if (obj is not GH_Component c)
            {
                continue;
            }

            if (existingIds.Contains(c.InstanceGuid))
            {
                continue;
            }

            var nickname = c.Params.Input.Count > 0 ? c.Params.Input[0].NickName : c.NickName;
            schema.Outputs.Add(new SchemaOutput
            {
                Id = c.InstanceGuid,
                Nickname = nickname,
                Description = "",
                Type = "text"
            });

            existingIds.Add(c.InstanceGuid);
        }
    }

    /// <summary>
    ///     Detect metadata changes in parameters since last scan.
    ///     Returns changed parameters and applies changes to the schema.
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

        if (schema == null)
        {
            return changes;
        }

        DetectChanges(document, schema.Inputs, changes.Inputs, i => i.Id, CreateInputFromSnapshot);
        DetectChanges(document, schema.Outputs, changes.Outputs, o => o.Id, CreateOutputFromSnapshot);

        if (changes.Inputs.Count > 0 || changes.Outputs.Count > 0)
        {
            ApplyMetadataChangesToSchema(schema, changes);
        }

        return changes;
    }

    /// <summary>
    ///     Generic change detection for any schema parameter collection.
    /// </summary>
    private void DetectChanges<TSchema, TDiscovered>(
        GH_Document document,
        List<TSchema> schemaParams,
        List<TDiscovered> changes,
        Func<TSchema, Guid> idSelector,
        Func<ParameterMetadataSnapshot, Guid, TDiscovered> factory)
    {
        foreach (var param in schemaParams)
        {
            var id = idSelector(param);
            var docObj = document.FindObject(id, false);
            if (docObj == null)
            {
                continue;
            }

            var snapshot = CreateParameterSnapshot(docObj);
            if (snapshot == null)
            {
                continue;
            }

            if (_metadataCache.TryGetValue(id, out var previous))
            {
                if (!snapshot.Equals(previous))
                {
                    changes.Add(factory(snapshot, id));
                    _metadataCache[id] = snapshot;
                }
            }
            else
            {
                _metadataCache[id] = snapshot;
            }
        }
    }

    /// <summary>
    ///     Clear the metadata cache (e.g. when the schema is disabled).
    /// </summary>
    public void ClearMetadataCache()
    {
        _metadataCache.Clear();
    }

    private ParameterMetadataSnapshot CreateParameterSnapshot(IGH_DocumentObject docObj)
    {
        if (docObj == null)
        {
            return null;
        }

        var contextParam = docObj as IGH_ContextualParameter;
        var ghParam = docObj as IGH_Param;

        // Output components (ContextPrint/ContextBake) use their first input param's NickName
        // as the user-facing label — match the same source as SyncNicknamesFromDocument.
        var nickname = docObj.NickName;
        if (docObj is GH_Component comp && contextParam == null && comp.Params.Input.Count > 0)
        {
            nickname = comp.Params.Input[0].NickName;
        }

        var snapshot = new ParameterMetadataSnapshot
        {
            Id = docObj.InstanceGuid,
            Nickname = nickname,
            Description = contextParam?.Prompt ?? ""
        };

        if (contextParam != null && ghParam != null)
        {
            var tempInput = new DiscoveredInput { Id = docObj.InstanceGuid };
            ParameterTypeHelper.ExtractNumberParameterConstraints(contextParam, ghParam, tempInput);
            snapshot.Minimum = tempInput.Minimum;
            snapshot.Maximum = tempInput.Maximum;
            snapshot.StepSize = tempInput.StepSize;
        }

        if (docObj is GetValueListParameter valueListParam)
        {
            snapshot.Options = valueListParam.Values;
        }

        return snapshot;
    }

    private static DiscoveredInput CreateInputFromSnapshot(ParameterMetadataSnapshot snapshot, Guid id)
    {
        var input = new DiscoveredInput
        {
            Id = id,
            Nickname = snapshot.Nickname,
            Description = snapshot.Description,
            Minimum = snapshot.Minimum,
            Maximum = snapshot.Maximum,
            StepSize = snapshot.StepSize
        };

        if (snapshot.Options != null)
        {
            input.Options = snapshot.Options.ToDictionary(kvp => kvp.Key, kvp => (object)kvp.Value);
        }

        return input;
    }

    private static DiscoveredOutput CreateOutputFromSnapshot(ParameterMetadataSnapshot snapshot, Guid id)
    {
        return new DiscoveredOutput
        {
            Id = id,
            Nickname = snapshot.Nickname,
            Description = snapshot.Description,
            Type = "text"
        };
    }

    #endregion

    #region Apply Metadata Changes

    /// <summary>
    ///     Apply detected metadata changes to the schema.
    ///     Updates layout item configs (min/max/stepSize, dropdown options).
    ///     Does NOT update layout displayNames — those are user-controlled in the UI.
    /// </summary>
    public void ApplyMetadataChangesToSchema(UISchema schema, DiscoveredParameters changes)
    {
        if (schema?.Layout == null || changes == null)
        {
            return;
        }

        if (changes.Inputs.Count == 0 && changes.Outputs.Count == 0)
        {
            return;
        }

        var itemsByParamId = GetAllLayoutItems(schema.Layout)
            .ToLookup(item => item.ParamId);

        foreach (var change in changes.Inputs)
        {
            foreach (var item in itemsByParamId[change.Id])
            {
                UpdateLayoutItemConfig(item, change);
                item.Description = change.Description;
            }

            var schemaInput = schema.Inputs.FirstOrDefault(i => i.Id == change.Id);
            if (schemaInput != null)
            {
                schemaInput.Nickname = change.Nickname;
                schemaInput.Description = change.Description;
            }
        }

        foreach (var change in changes.Outputs)
        {
            foreach (var item in itemsByParamId[change.Id])
            {
                item.Description = change.Description;
            }

            var schemaOutput = schema.Outputs.FirstOrDefault(o => o.Id == change.Id);
            if (schemaOutput != null)
            {
                schemaOutput.Nickname = change.Nickname;
                schemaOutput.Description = change.Description;
            }
        }
    }

    private static void UpdateLayoutItemConfig(LayoutItemBase item, DiscoveredInput change)
    {
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
    }

    #endregion

    #region Sync

    /// <summary>
    ///     Compute a diff between current Grasshopper state and schema state.
    ///     For inputs: syncs GH nickname ↔ layout displayName.
    ///     For outputs: syncs GH component input-parameter nickname ↔ layout displayName.
    ///     Descriptions and min/max/stepSize are not synced here.
    /// </summary>
    public static SyncDiff ComputeSyncDiff(UISchema schema, GH_Document document)
    {
        var diff = new SyncDiff();
        if (schema == null || document == null)
        {
            return diff;
        }

        var layoutLookup = GetAllLayoutItems(schema.Layout).ToDictionary(item => item.ParamId);

        if (schema.Inputs != null)
        {
            foreach (var input in schema.Inputs)
            {
                var docObj = document.FindObject(input.Id, false);
                if (docObj == null)
                {
                    continue;
                }

                var displayName = layoutLookup.TryGetValue(input.Id, out var item)
                    ? item.DisplayName
                    : input.Nickname;

                if (docObj.NickName != displayName)
                {
                    AddBidirectionalChange(diff, input.Id, docObj.NickName, displayName);
                }
            }
        }

        if (schema.Outputs != null)
        {
            foreach (var output in schema.Outputs)
            {
                if (document.FindObject(output.Id, false) is not GH_Component component)
                {
                    continue;
                }

                if (component.Params.Input.Count == 0)
                {
                    continue;
                }

                var inputParam = component.Params.Input[0];
                if (inputParam == null)
                {
                    continue;
                }

                var displayName = layoutLookup.TryGetValue(output.Id, out var item)
                    ? item.DisplayName
                    : output.Nickname;

                if (inputParam.NickName != displayName)
                {
                    AddBidirectionalChange(diff, output.Id, inputParam.NickName, displayName);
                }
            }
        }

        return diff;
    }

    private static void AddBidirectionalChange(SyncDiff diff, Guid paramId, string ghValue, string schemaValue)
    {
        var id = paramId.ToString();

        diff.FromGH.Add(new SyncChange
        {
            ParamId = id,
            ParamNickname = ghValue,
            Field = "nickname",
            GHValue = ghValue,
            SchemaValue = schemaValue,
            Direction = SyncDirection.FromGH
        });

        diff.ToGH.Add(new SyncChange
        {
            ParamId = id,
            ParamNickname = ghValue,
            Field = "nickname",
            GHValue = ghValue,
            SchemaValue = schemaValue,
            Direction = SyncDirection.ToGH
        });
    }

    /// <summary>
    ///     Apply selected sync changes to both Grasshopper document and schema.
    ///     Returns the updated schema if any "fromGH" changes were applied, null otherwise.
    /// </summary>
    public static UISchema ApplySyncChanges(List<SyncChange> changes, GH_Document document, UISchema schema)
    {
        if (changes == null || document == null || schema == null)
        {
            return schema;
        }

        var schemaModified = false;
        var layoutItems = GetAllLayoutItems(schema.Layout).ToList();

        foreach (var change in changes)
        {
            if (!Guid.TryParse(change.ParamId, out var paramGuid))
            {
                continue;
            }

            var docObj = document.FindObject(paramGuid, false);
            if (docObj == null)
            {
                continue;
            }

            try
            {
                schemaModified |= change.Direction == SyncDirection.ToGH
                    ? ApplyToGH(change, paramGuid, docObj, schema)
                    : ApplyFromGH(change, paramGuid, docObj, schema, layoutItems);

                docObj.Attributes.ExpireLayout();
            }
            catch (Exception ex)
            {
                Logger.Warn($"Error applying sync change to parameter {change.ParamNickname}: {ex.Message}");
            }
        }

        Instances.ActiveCanvas?.Refresh();
        return schemaModified ? schema : null;
    }

    private static bool ApplyToGH(SyncChange change, Guid paramGuid, IGH_DocumentObject docObj, UISchema schema)
    {
        if (change.Field != "nickname" || change.SchemaValue is not string displayName)
        {
            return false;
        }

        // Try as input
        var input = schema.Inputs?.FirstOrDefault(i => i.Id == paramGuid);
        if (input != null)
        {
            docObj.NickName = displayName;
            input.Nickname = displayName;
            return true;
        }

        // Try as output
        var output = schema.Outputs?.FirstOrDefault(o => o.Id == paramGuid);
        if (output != null && docObj is GH_Component component && component.Params.Input.Count > 0)
        {
            var inputParam = component.Params.Input[0];
            if (inputParam != null)
            {
                inputParam.NickName = displayName;
                output.Nickname = displayName;
                component.ExpireSolution(true);
                return true;
            }
        }

        return false;
    }

    private static bool ApplyFromGH(
        SyncChange change, Guid paramGuid, IGH_DocumentObject docObj,
        UISchema schema, List<LayoutItemBase> allLayoutItems)
    {
        if (change.Field != "nickname")
        {
            return false;
        }

        var modified = false;

        // Update input: GH nickname → schema input + layout displayName
        var input = schema.Inputs?.FirstOrDefault(i => i.Id == paramGuid);
        if (input != null)
        {
            var ghNickname = docObj.NickName;
            input.Nickname = ghNickname;
            SetLayoutDisplayName(allLayoutItems, paramGuid, ghNickname);
            modified = true;
        }

        // Update output: GH component input-param nickname → schema output + layout displayName
        var output = schema.Outputs?.FirstOrDefault(o => o.Id == paramGuid);
        if (output != null && docObj is GH_Component component && component.Params.Input.Count > 0)
        {
            var inputParam = component.Params.Input[0];
            if (inputParam != null)
            {
                var ghNickname = inputParam.NickName;
                output.Nickname = ghNickname;
                SetLayoutDisplayName(allLayoutItems, paramGuid, ghNickname);
                modified = true;
            }
        }

        return modified;
    }

    private static void SetLayoutDisplayName(IEnumerable<LayoutItemBase> items, Guid paramId, string name)
    {
        var item = items.FirstOrDefault(i => i.ParamId == paramId);
        if (item != null)
        {
            item.DisplayName = name;
        }
    }

    #endregion

    #region Helpers

    /// <summary>
    ///     Map a contextual parameter to its Compute-compatible type name.
    /// </summary>
    private static string ResolveParameterTypeName(IGH_ContextualParameter contextParam)
    {
        if (contextParam is not IGH_Param param)
        {
            return "generic";
        }

        var clrType = param.GetType();
        if (TypeNameCache.TryGetValue(clrType, out var cached))
        {
            return cached;
        }

        var typeName = clrType.Name;
        var resolved = "generic";
        foreach (var kvp in ParameterTypeKeywords)
        {
            if (typeName.Contains(kvp.Key))
            {
                resolved = kvp.Value;
                break;
            }
        }

        TypeNameCache[clrType] = resolved;
        return resolved;
    }

    /// <summary>
    ///     Returns all layout items from either a tabbed or flat layout.
    /// </summary>
    private static IEnumerable<LayoutItemBase> GetAllLayoutItems(LayoutConfigBase layout)
    {
        if (layout is TabbedLayoutConfig { Tabs: not null } tabbed)
        {
            return tabbed.Tabs.SelectMany(t => t.Groups).SelectMany(g => g.Items);
        }

        if (layout is FlatLayoutConfig { Groups: not null } flat)
        {
            return flat.Groups.SelectMany(g => g.Items);
        }

        return Enumerable.Empty<LayoutItemBase>();
    }

    #endregion
}

/// <summary>
///     Snapshot of parameter metadata for change detection.
/// </summary>
internal sealed class ParameterMetadataSnapshot : IEquatable<ParameterMetadataSnapshot>
{
    public Guid Id { get; set; }
    public string Nickname { get; set; }
    public string Description { get; set; }
    public double? Minimum { get; set; }
    public double? Maximum { get; set; }
    public double? StepSize { get; set; }
    public Dictionary<string, string> Options { get; set; }

    public bool Equals(ParameterMetadataSnapshot other)
    {
        if (other is null)
        {
            return false;
        }

        if (ReferenceEquals(this, other))
        {
            return true;
        }

        return Id == other.Id
               && Nickname == other.Nickname
               && Description == other.Description
               && Minimum == other.Minimum
               && Maximum == other.Maximum
               && StepSize == other.StepSize
               && OptionsEqual(Options, other.Options);
    }

    public override bool Equals(object obj)
    {
        return Equals(obj as ParameterMetadataSnapshot);
    }

    public override int GetHashCode()
    {
        // Consistent with Equals — includes all fields used in equality comparison
        unchecked
        {
            var hash = Id.GetHashCode();
            hash = (hash * 397) ^ (Nickname?.GetHashCode() ?? 0);
            hash = (hash * 397) ^ (Description?.GetHashCode() ?? 0);
            hash = (hash * 397) ^ Minimum.GetHashCode();
            hash = (hash * 397) ^ Maximum.GetHashCode();
            hash = (hash * 397) ^ StepSize.GetHashCode();
            return hash;
        }
    }

    private static bool OptionsEqual(Dictionary<string, string> a, Dictionary<string, string> b)
    {
        if (a == null && b == null)
        {
            return true;
        }

        if (a == null || b == null)
        {
            return false;
        }

        if (a.Count != b.Count)
        {
            return false;
        }

        foreach (var kvp in a)
        {
            if (!b.TryGetValue(kvp.Key, out var value) || value != kvp.Value)
            {
                return false;
            }
        }

        return true;
    }
}
