using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Special;
using Newtonsoft.Json;
using Selva.GH.Features.Inventory.Services;
using Selva.Schema.Models;

namespace Selva.GH.Features.Inventory;

/// <summary>
///     Entry points the compute fork calls by reflection (FixedEndpoints, grasshopper/schema and
///     grasshopper/scripts). Matched there by full type name and method name: renaming either
///     compiles clean here and silently drops the inventory on every server.
/// </summary>
public static class InventoryExtractor
{
    /// <summary>The document's inventory as JSON, or null when it cannot be read.</summary>
    public static string ToComputeJson(GH_Document doc, GH_Archive archive)
    {
        if (doc == null) return null;
        var objects = doc.Objects.Where(o => o is IGH_ActiveObject).ToList();
        var inventory = InventoryBuilder.Build(
            typeof(InventoryExtractor).Assembly.GetName().Version?.ToString() ?? "",
            SavedLibraries(archive),
            Instances.ComponentServer.Libraries.Select(l => new LoadedLibrary(l.Id, l.Name, l.Version)),
            objects.Select(CanvasObjectOf),
            objects.SelectMany(ValuesOf),
            objects.Select(ScriptOf).Where(s => s != null),
            Wires(objects));
        return InventoryBuilder.ToJson(inventory);
    }

    /// <summary>
    ///     Source of the scripts named in <paramref name="idsCsv" /> (comma-separated InstanceGuids),
    ///     as a JSON array of ScriptSource. Ids that are not scripts are left out.
    /// </summary>
    public static string ScriptSourcesJson(GH_Document doc, string idsCsv)
    {
        var ids = new HashSet<Guid>((idsCsv ?? "")
            .Split(',')
            .Select(s => Guid.TryParse(s.Trim(), out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty));
        var scripts = doc?.Objects
            .Where(o => ids.Contains(o.InstanceGuid))
            .Select(ScriptOf)
            .Where(s => s != null)
            .Select(s => new ScriptSource { Id = s.Id, Label = s.Label, Language = s.Language, Source = s.Source })
            .ToList() ?? new List<ScriptSource>();
        return JsonConvert.SerializeObject(scripts);
    }

    // ========================================================================
    // Libraries and components
    // ========================================================================

    // From the archive, not the loaded document: a plugin the server lacks never loads its
    // components, so only the archive still names it.
    static IEnumerable<ArchiveLibrary> SavedLibraries(GH_Archive archive)
    {
        var libraries = archive?.GetRootNode?.FindChunk("Definition")?.FindChunk("GHALibraries");
        if (libraries == null) yield break;
        foreach (var chunk in libraries.Chunks.OfType<GH_IReader>())
        {
            yield return new ArchiveLibrary(
                chunk.ItemExists("Id") ? chunk.GetGuid("Id") : Guid.Empty,
                Text(chunk, "Name"),
                Text(chunk, "Author"),
                Text(chunk, "Version"));
        }
    }

    static string Text(GH_IReader chunk, string name) => chunk.ItemExists(name) ? chunk.GetString(name) ?? "" : "";

    static CanvasObject CanvasObjectOf(IGH_DocumentObject obj) => new(
        obj.InstanceGuid,
        obj.ComponentGuid,
        obj.Name ?? "",
        obj.NickName ?? "",
        Instances.ComponentServer.FindAssemblyByObject(obj)?.Id ?? Guid.Empty,
        obj.Obsolete);

    // ========================================================================
    // Values set on the canvas
    // ========================================================================

    static IEnumerable<CanvasValue> ValuesOf(IGH_DocumentObject obj)
    {
        var label = string.IsNullOrEmpty(obj.NickName) ? obj.Name : obj.NickName;
        switch (obj)
        {
            case GH_NumberSlider slider:
                yield return new CanvasValue(obj.InstanceGuid.ToString(), null, "slider", label,
                    slider.CurrentValue.ToString(CultureInfo.InvariantCulture),
                    (double)slider.Slider.Minimum, (double)slider.Slider.Maximum);
                yield break;
            case GH_Panel panel:
                // A wired panel shows computed data; only a free-standing one holds a value.
                if (panel.SourceCount == 0)
                    yield return new CanvasValue(obj.InstanceGuid.ToString(), null, "panel", label, panel.UserText ?? "");
                yield break;
            case GH_BooleanToggle toggle:
                yield return new CanvasValue(obj.InstanceGuid.ToString(), null, "toggle", label, toggle.Value ? "True" : "False");
                yield break;
            case GH_ValueList list:
                yield return new CanvasValue(obj.InstanceGuid.ToString(), null, "valueList", label,
                    string.Join(", ", list.SelectedItems.Select(i => i.Name)));
                yield break;
            case IGH_Param param:
                if (PersistentText(param) is { } floating)
                    yield return new CanvasValue(obj.InstanceGuid.ToString(), null, "persistent", label, floating);
                yield break;
            case IGH_Component component:
                foreach (var input in component.Params.Input)
                {
                    if (PersistentText(input) is { } text)
                    {
                        yield return new CanvasValue($"{obj.InstanceGuid}/i{component.Params.Input.IndexOf(input)}", obj.InstanceGuid.ToString(), "persistent",
                            $"{label} › {input.NickName}", text);
                    }
                }
                yield break;
        }
    }

    // Internalised data: what a parameter feeds when nothing is wired into it.
    static string PersistentText(IGH_Param param)
    {
        if (param.SourceCount > 0 || param.DataType != GH_ParamData.local) return null;
        var data = param.GetType().GetProperty("PersistentData")?.GetValue(param) as IGH_Structure;
        if (data == null || data.IsEmpty) return null;
        return data.DataDescription(false, data.PathCount > 1);
    }

    // ========================================================================
    // Scripts
    // ========================================================================

    // Script components come from three plugins Selva cannot reference, so each is read by member
    // name: RhinoCode (Rhino 8+, IScriptComponent.Text), the Roslyn C#/VB components
    // (ScriptSource) and GhPython (Code). A component none of them matches is not a script.
    static CanvasScript ScriptOf(IGH_DocumentObject obj)
    {
        var label = string.IsNullOrEmpty(obj.NickName) ? obj.Name : obj.NickName;
        var type = obj.GetType();

        var rhinoCode = type.GetInterfaces().FirstOrDefault(i => i.Name == "IScriptComponent");
        if (rhinoCode != null)
        {
            var text = Read(rhinoCode.GetProperty("Text"), obj) as string;
            var spec = Read(rhinoCode.GetProperty("LanguageSpec"), obj)?.ToString();
            return new CanvasScript(obj.InstanceGuid, label, InventoryBuilder.LanguageFromSpec(spec), text ?? "");
        }

        if (Read(type.GetProperty("ScriptSource"), obj) is { } roslyn)
        {
            var parts = new[] { "UsingCode", "ScriptCode", "AdditionalCode" }
                .Select(p => Read(roslyn.GetType().GetProperty(p), roslyn) as string)
                .Where(s => !string.IsNullOrEmpty(s));
            var language = type.Name.IndexOf("VB", StringComparison.Ordinal) >= 0 ? "vb" : "csharp";
            return new CanvasScript(obj.InstanceGuid, label, language, string.Join("\n", parts));
        }

        if (IsNamed(type, "ScriptingAncestorComponent"))
            return new CanvasScript(obj.InstanceGuid, label, "ironpython2", Read(type.GetProperty("Code"), obj) as string ?? "");

        return null;
    }

    static bool IsNamed(Type type, string name)
    {
        for (var t = type; t != null; t = t.BaseType)
            if (t.Name == name) return true;
        return false;
    }

    static object Read(PropertyInfo property, object target)
    {
        try { return property?.GetValue(target); }
        catch { return null; }
    }

    // ========================================================================
    // Wires
    // ========================================================================

    // Ends are named from the owning component's own parameter lists, not from Attributes: a
    // headless load has none to walk up. A source whose component did not load (its plugin is
    // missing) is a dangling parameter with a new InstanceGuid on every load, so it is "missing".
    static IEnumerable<CanvasWire> Wires(List<IGH_DocumentObject> objects)
    {
        var ends = new Dictionary<IGH_Param, string>();
        var inputs = new List<IGH_Param>();
        foreach (var obj in objects)
        {
            switch (obj)
            {
                case IGH_Component component:
                    for (var i = 0; i < component.Params.Input.Count; i++)
                        ends[component.Params.Input[i]] = $"{component.InstanceGuid:N}/i{i}";
                    for (var i = 0; i < component.Params.Output.Count; i++)
                        ends[component.Params.Output[i]] = $"{component.InstanceGuid:N}/o{i}";
                    inputs.AddRange(component.Params.Input);
                    break;
                case IGH_Param param:
                    ends[param] = param.InstanceGuid.ToString("N");
                    inputs.Add(param);
                    break;
            }
        }

        string End(IGH_Param p) => ends.TryGetValue(p, out var end) ? end : "missing";
        return inputs.SelectMany(p => p.Sources.Select(s => new CanvasWire(End(s), End(p))));
    }
}
