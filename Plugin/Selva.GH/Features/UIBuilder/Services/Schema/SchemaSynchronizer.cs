using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Reflection;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Special;
using Selva.Schema.Models;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Manages parameter scanning, schema validation, and synchronization between
///     Grasshopper documents and UI schemas.
/// </summary>
public class SchemaSynchronizer
{
    #region Static Configuration

    /// <summary>
    ///     Keyword → type name mapping, checked via string.Contains against the GH type name.
    /// </summary>
    private static readonly Dictionary<string, string> ParameterTypeKeywords = new Dictionary<string, string>
    {
        { "GetNumberParameter", "number" },
        { "Slider", "number" },
        // Must precede ValueList: the type name contains "ValueList" and matching is first-hit.
        { "DynamicValueList", "dynamicValueList" },
        { "ValueList", "valueList" },
        { "GetFile", "file" },
        // GetImage carries a FileInputData payload like GetFile, differing only in its
        // accepted-format allowlist.
        { "GetImage", "file" },
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

    // Not thread-safe — fine while GH processes documents on one thread.
    private static readonly Dictionary<Type, string> TypeNameCache = new Dictionary<Type, string>();

    #endregion

    #region Instance State

    private readonly Dictionary<Guid, ParameterMetadataSnapshot> _metadataCache =
        new Dictionary<Guid, ParameterMetadataSnapshot>();

    private readonly string _sessionId;

    public SchemaSynchronizer(string sessionId)
    {
        _sessionId = sessionId;
    }

    #endregion

    #region Parameter Scanning

    /// <summary>
    ///     Scans the document for all discoverable inputs and outputs in a single pass.
    ///     When <paramref name="ownerComponent" /> is given, only ContextBake/ContextPrint
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
        var (contextParams, printComponents, bakeComponents) =
            ClassifyDocumentObjects(document, scopeFilter);
        var groupLookup = BuildGroupLookup(document);

        CollectPrintOutputs(printComponents, result.Outputs, groupLookup);
        CollectFileOutputs(bakeComponents, result.Outputs, groupLookup);
        CollectChartOutputs(bakeComponents, result.Outputs, groupLookup);
        CollectDynamicValueListOutputs(bakeComponents, result.Outputs, groupLookup);
        CollectInputs(contextParams, result.Inputs, groupLookup);

        return result;
    }

    /// <summary>
    ///     Builds a Guid → group nickname lookup for each object's directly-enclosing GH group.
    ///     If an object sits in multiple overlapping groups, the innermost (smallest member count) wins.
    /// </summary>
    private static Dictionary<Guid, string> BuildGroupLookup(GH_Document document)
    {
        var lookup = new Dictionary<Guid, string>();
        if (document == null)
        {
            return lookup;
        }

        // Sort by member count descending so smaller (innermost) groups overwrite larger ones below.
        var groups = document.Objects.OfType<GH_Group>()
            .Where(g => g.ObjectIDs != null && g.ObjectIDs.Count > 0)
            .OrderByDescending(g => g.ObjectIDs.Count);

        foreach (var group in groups)
        {
            var name = group.NickName;
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            foreach (var memberId in group.ObjectIDs)
            {
                lookup[memberId] = name;
            }
        }

        return lookup;
    }

    private static string ResolveGroupName(Dictionary<Guid, string> lookup, Guid id)
    {
        return lookup != null && lookup.TryGetValue(id, out var name) ? name : null;
    }

    /// <summary>
    ///     Determines which context components are "in scope" for the given owner.
    ///     Null when no owner is specified — everything is in scope.
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

            // Context Print components use GH's contextual mechanism (not wires), so always in scope.
            if (isPrint ||
                ParameterTypeHelper.IsWiredToOwner(c, ownerComponent.InstanceGuid) ||
                ParameterTypeHelper.IsQualifyingBakeOutput(c))
            {
                inScope.Add(c.InstanceGuid);
            }
        }

        return inScope;
    }

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

    private static void CollectPrintOutputs(
        List<GH_Component> printComponents, List<DiscoveredOutput> outputs, Dictionary<Guid, string> groupLookup)
    {
        foreach (var c in printComponents)
        {
            var param = c.Params.Input.Count > 0 ? c.Params.Input[0] : null;
            outputs.Add(new DiscoveredOutput
            {
                Id = c.InstanceGuid,
                Nickname = param?.NickName ?? "Output",
                Description = "",
                Type = "text",
                GroupName = ResolveGroupName(groupLookup, c.InstanceGuid)
            });
        }
    }

    private static void CollectFileOutputs(
        List<GH_Component> bakeComponents, List<DiscoveredOutput> outputs, Dictionary<Guid, string> groupLookup)
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
                Type = "file",
                GroupName = ResolveGroupName(groupLookup, c.InstanceGuid)
            });
        }
    }

    private static void CollectChartOutputs(
        List<GH_Component> bakeComponents, List<DiscoveredOutput> outputs, Dictionary<Guid, string> groupLookup)
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
                Type = "chart",
                GroupName = ResolveGroupName(groupLookup, c.InstanceGuid)
            });
        }
    }

    private static void CollectDynamicValueListOutputs(
        List<GH_Component> bakeComponents, List<DiscoveredOutput> outputs, Dictionary<Guid, string> groupLookup)
    {
        foreach (var c in bakeComponents)
        {
            if (!ParameterTypeHelper.IsDynamicValueListBakeComponent(c))
            {
                continue;
            }

            outputs.Add(new DiscoveredOutput
            {
                Id = c.InstanceGuid,
                Nickname = c.Params.Input[0].NickName,
                Description = "",
                Type = "dynamicValueList",
                TargetInputId = ParameterTypeHelper.ResolveDynamicValueListTargetId(c),
                GroupName = ResolveGroupName(groupLookup, c.InstanceGuid)
            });
        }
    }

    private static void CollectInputs(
        List<IGH_ContextualParameter> contextParams, List<DiscoveredInput> inputs, Dictionary<Guid, string> groupLookup)
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
                AtMost = param.AtMost,
                GroupName = ResolveGroupName(groupLookup, docObj.InstanceGuid)
            };

            PopulateInputDefault(param, ghParam, input);
            ExtractTreeAccess(param, input);
            ParameterTypeHelper.ExtractNumberParameterConstraints(param, ghParam, input);
            PopulateAcceptedFormats(param, input);

            inputs.Add(input);
        }
    }

    /// <summary>
    ///     Seeds the accepted-format allowlist per parameter kind (image extensions for Get Image,
    ///     geometry for Get File) instead of one hardcoded list for both.
    /// </summary>
    private static void PopulateAcceptedFormats(IGH_ContextualParameter param, DiscoveredInput input)
    {
        switch (param)
        {
            case GetImageParameter:
                input.AcceptedFormats = FileIO.Services.ImageInputResolver.AcceptedFormats.ToList();
                break;
            case GetFileParameter:
                input.AcceptedFormats = AcceptedFileFormats.Values.ToList();
                break;
        }
    }

    private static void PopulateInputDefault(IGH_ContextualParameter param, IGH_Param ghParam, DiscoveredInput input)
    {
        if (param is GetValueListParameter valueList)
        {
            PopulateValueListDefault(valueList, ghParam, input);
            return;
        }

        if (param is GetDynamicValueListParameter dynamicValueList)
        {
            PopulateDynamicValueListDefault(dynamicValueList, input);
            return;
        }

        // TODO: handle tree inputs properly (not a priority for now)
        var raw = ExtractFirstScriptVariable(ghParam);

        // GH_Colour.ScriptVariable() returns System.Drawing.Color, which Newtonsoft can't
        // serialize on Mono/macOS (throws ArgumentNullException 'key'). Emit hex instead —
        // GetColorParameter parses hex the same way on the way in.
        input.Default = raw is Color color ? ColorTranslator.ToHtml(color) : raw;
    }

    /// <summary>
    ///     Best-effort read of a parameter's first scalar value: volatile data (solved output),
    ///     then persistent data, then the wired source's volatile/persistent data. Null if
    ///     nothing is set anywhere.
    /// </summary>
    private static object ExtractFirstScriptVariable(IGH_Param ghParam)
    {
        if (ghParam == null)
        {
            return null;
        }

        var fromVolatile = ghParam.VolatileData?.AllData(true).FirstOrDefault()?.ScriptVariable();
        if (fromVolatile != null)
        {
            return fromVolatile;
        }

        var fromPersistent = ExtractPersistentScriptVariable(ghParam);
        if (fromPersistent != null)
        {
            return fromPersistent;
        }

        if (ghParam.SourceCount > 0)
        {
            foreach (var source in ghParam.Sources)
            {
                if (source == null)
                {
                    continue;
                }

                var sourceVolatile = source.VolatileData?.AllData(true).FirstOrDefault()?.ScriptVariable();
                if (sourceVolatile != null)
                {
                    return sourceVolatile;
                }

                var sourcePersistent = ExtractPersistentScriptVariable(source);
                if (sourcePersistent != null)
                {
                    return sourcePersistent;
                }

                // GH_BooleanToggle exposes its value via a "Value" property, not PersistentData.
                if (TryGetPropertyValue<bool>(source, "Value", out var boolValue))
                {
                    return boolValue;
                }
            }
        }

        return null;
    }

    private static object ExtractPersistentScriptVariable(IGH_Param ghParam)
    {
        try
        {
            var persistentDataProp = ghParam.GetType()
                .GetProperty("PersistentData", BindingFlags.Public | BindingFlags.Instance);
            if (persistentDataProp?.GetValue(ghParam) is IGH_Structure structure && !structure.IsEmpty)
            {
                return structure.AllData(true).FirstOrDefault()?.ScriptVariable();
            }
        }
        catch
        {
            // Non-fatal — caller treats null as "no default".
        }

        return null;
    }

    private static bool TryGetPropertyValue<T>(object obj, string propName, out T value)
    {
        value = default;
        if (obj == null)
        {
            return false;
        }

        try
        {
            var prop = obj.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null)
            {
                return false;
            }

            var raw = prop.GetValue(obj);
            if (raw is T t)
            {
                value = t;
                return true;
            }
        }
        catch
        {
            // ignored
        }

        return false;
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

            // VolatileData is empty right after document load (only populated by a solve) —
            // fall back to the connected value list's live selection.
            var selectedValue = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable();
            var selectedString = selectedValue?.ToString() ?? valueList.GetDefaultValue();
            if (string.IsNullOrEmpty(selectedString) || input.Options == null)
            {
                return;
            }
            input.Default = input.Options
                .Where(kvp => kvp.Value?.ToString() == selectedString)
                .Select(kvp => (object)kvp.Key)
                .FirstOrDefault() ?? input.Options.Keys.FirstOrDefault();
        }
        catch
        {
            // ignored
        }
    }

    private static void PopulateDynamicValueListDefault(GetDynamicValueListParameter param, DiscoveredInput input)
    {
        try
        {
            if (param.Values is { Count: > 0 } values)
            {
                var options = new Dictionary<string, object>();
                foreach (var kvp in values)
                {
                    options[kvp.Key] = kvp.Value;
                }

                input.Options = options;
                input.Default = param.GetDefaultValue();
            }
        }
        catch
        {
            // ignored
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
            // ignored
        }
    }

    /// <summary>
    ///     Writes layout-item config flags that affect GH parameter behavior back onto the document:
    ///     a dropdown's `displayAs = "checklist"` switches its GetValueListParameter to list access,
    ///     and the target input picked in the web builder is written onto the matching
    ///     GH_DynamicValueListOutput so the component stays the source of truth.
    /// </summary>
    public void ApplyParameterAccessFromSchema(UISchema schema, GH_Document document)
    {
        if (schema?.Layout == null || document == null)
        {
            return;
        }

        foreach (var item in GetAllLayoutItems(schema.Layout))
        {
            switch (item)
            {
                case InputDropdownLayoutItem dropdown when dropdown.Config != null:
                    {
                        if (document.FindObject(dropdown.ParamId, false) is GetValueListParameter valueList)
                        {
                            var listAccess = string.Equals(dropdown.Config.DisplayAs, "checklist",
                                StringComparison.OrdinalIgnoreCase);
                            valueList.SetListAccess(listAccess);
                        }

                        break;
                    }

                case OutputDynamicValueListLayoutItem dvl when dvl.Config != null:
                    {
                        // ParamId is the ContextBake's GUID (the output identity) — walk up to the
                        // GH_DynamicValueListOutput feeding it to write the picked target back.
                        if (document.FindObject(dvl.ParamId, false) is GH_Component bake &&
                            ParameterTypeHelper.FindUpstreamDynamicValueListOutput(bake) is { } output &&
                            output.TargetInputId != dvl.Config.TargetInputId)
                        {
                            output.TargetInputId = dvl.Config.TargetInputId;
                            // Not downstream of the UIBuilder, so the post-save expire won't reach
                            // it — expire directly so the stale "no target" remark clears.
                            output.ExpireSolution(false);
                        }

                        break;
                    }
            }
        }
    }

    #endregion

    #region Schema Validation

    /// <summary>
    ///     Validates the schema against the current document, removing references to missing parameters.
    /// </summary>
    public UISchema ValidateSchema(UISchema schema, GH_Document document)
    {
        ValidateSchemaAndTrackChanges(schema, document, out _);
        return schema;
    }

    /// <summary>
    ///     Reconciles schema nicknames against the current document — used on startup/enable to fix
    ///     drift from while Rhino was closed. Unlike DetectMetadataChanges, this bypasses the
    ///     snapshot cache and always reads current GH state. Returns true if anything changed.
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

        // Seed the metadata cache so the first UndoStateChanged after startup has a baseline
        // instead of reporting everything as changed.
        if (changed)
        {
            ClearMetadataCache();
        }

        return changed;
    }

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

        // dynamicValueList layout items must mirror into schema.Outputs so every consumer reads
        // one canonical place — this is the funnel every save/connect passes through.
        SchemaOutputCanonicalizer.CanonicalizeDynamicValueListOutputs(schema);
    }

    private static HashSet<Guid> CollectAllReferencedIds(UISchema schema)
    {
        var ids = new HashSet<Guid>();

        ids.UnionWith(schema.Inputs.Select(i => i.Id));
        ids.UnionWith(schema.Outputs.Select(o => o.Id));
        ids.UnionWith(GetAllLayoutItems(schema.Layout).Where(item => item.Type != "linebreak")
            .Select(item => item.ParamId));

        return ids;
    }

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

    private static List<Guid> PurgeStaleReferences(UISchema schema, HashSet<Guid> existingIds)
    {
        var removed = new List<Guid>();

        removed.AddRange(schema.Inputs.Where(i => !existingIds.Contains(i.Id)).Select(i => i.Id));
        removed.AddRange(schema.Outputs.Where(o => !existingIds.Contains(o.Id)).Select(o => o.Id));

        var removedSet = new HashSet<Guid>(removed);
        schema.Inputs.RemoveAll(i => removedSet.Contains(i.Id));
        schema.Outputs.RemoveAll(o => removedSet.Contains(o.Id));

        PurgeStaleLayoutItems(schema.Layout, existingIds);

        return removed;
    }

    /// <summary>
    ///     Removes layout items whose parameters no longer exist, then cleans up empty groups and tabs.
    ///     Matches on the concrete layout types because RemoveAll needs a reference to the actual
    ///     group/tab list, not an interface view.
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
    ///     Ensures every contextual parameter in the document is tracked in schema.Inputs, even
    ///     without a layout item. Only appends genuinely new parameters; existing ones are untouched.
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
    ///     After a solve, syncs ContextBake outputs in the schema: adds newly-qualifying bakes
    ///     (file/chart now wired correctly) and removes bakes still on the canvas but no longer
    ///     qualifying (unwired). Returns (addedIds, removedIds) so the caller can broadcast them.
    /// </summary>
    public (List<Guid> Added, List<Guid> Removed) MergePostSolveBakeOutputs(UISchema schema, GH_Document document)
    {
        var added = new List<Guid>();
        var removed = new List<Guid>();
        if (schema == null || document == null)
        {
            return (added, removed);
        }

        var bakeComponents = new Dictionary<Guid, GH_Component>();
        foreach (var obj in document.Objects)
        {
            if (ParameterTypeHelper.IsContextBakeComponent(obj) && obj is GH_Component c)
            {
                bakeComponents[c.InstanceGuid] = c;
            }
        }

        // Route through ClassifyBakeOutputType (the same qualifying set: file/chart/dynamicValueList)
        // rather than a separate check here — otherwise a DynVL bake gets stripped every solve,
        // fighting the canonicalizer and producing spurious "1 parameter removed" churn.
        var toRemove = schema.Outputs
            .Where(o => bakeComponents.TryGetValue(o.Id, out var c)
                        && !ParameterTypeHelper.IsQualifyingBakeOutput(c))
            .Select(o => o.Id)
            .ToList();

        if (toRemove.Count > 0)
        {
            schema.Outputs.RemoveAll(o => toRemove.Contains(o.Id));
            removed.AddRange(toRemove);
        }

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

            var type = ParameterTypeHelper.ClassifyBakeOutputType(kvp.Value);
            if (type == null)
            {
                continue;
            }

            var targetInputId = type == "dynamicValueList"
                ? ParameterTypeHelper.ResolveDynamicValueListTargetId(kvp.Value)
                : Guid.Empty;

            schema.Outputs.Add(new SchemaOutput
            {
                Id = kvp.Key,
                Nickname = kvp.Value.Params.Input[0].NickName,
                Description = "",
                Type = type,
                TargetInputId = targetInputId
            });

            existingIds.Add(kvp.Key);
            added.Add(kvp.Key);
        }

        return (added, removed);
    }

    /// <summary>
    ///     Auto-merges ContextPrint components into schema.Outputs (mirrors MergeDiscoveredInputs).
    ///     ContextBake is excluded — it needs a solve to know what it's connected to.
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
    ///     Detects metadata changes in parameters since the last scan and applies them to the schema.
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

        // Output components use their first input param's NickName as the label, matching
        // SyncNicknamesFromDocument.
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
    ///     Applies detected metadata changes to the schema: layout item configs (min/max/stepSize,
    ///     dropdown options). Does NOT update layout displayNames — those are user-controlled.
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
    ///     Computes a diff between current Grasshopper state and schema state: GH nickname ↔ layout
    ///     displayName for inputs, and the component's input-parameter nickname ↔ displayName for
    ///     outputs. Descriptions and min/max/stepSize are not synced here.
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
    ///     Applies selected sync changes to both the Grasshopper document and the schema.
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

        var input = schema.Inputs?.FirstOrDefault(i => i.Id == paramGuid);
        if (input != null)
        {
            docObj.NickName = displayName;
            input.Nickname = displayName;
            return true;
        }

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

        var input = schema.Inputs?.FirstOrDefault(i => i.Id == paramGuid);
        if (input != null)
        {
            var ghNickname = docObj.NickName;
            input.Nickname = ghNickname;
            SetLayoutDisplayName(allLayoutItems, paramGuid, ghNickname);
            modified = true;
        }

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
    ///     Forwards to the Rhino-free <see cref="SchemaOutputCanonicalizer.GetAllLayoutItems" /> —
    ///     the single implementation for flattening tabbed or flat layouts.
    /// </summary>
    public static IEnumerable<LayoutItemBase> GetAllLayoutItems(LayoutConfigBase layout)
    {
        return SchemaOutputCanonicalizer.GetAllLayoutItems(layout);
    }

    #endregion
}

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
