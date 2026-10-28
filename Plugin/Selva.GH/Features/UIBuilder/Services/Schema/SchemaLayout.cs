using System;
using System.Linq;
using Grasshopper.Kernel;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.UIBuilder.Components;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     <see cref="LayoutSpec" /> on a live definition, for scripts and agents. JSON text in and out, so
///     a host that cannot name Selva's types (Rhino MCP's run_csharp) calls it by reflection. The
///     document needs one UI Bridge, and must have solved once so Context Bake outputs are known.
/// </summary>
public static class SchemaLayout
{
    /// <summary>The layout as a spec, plus every input and output no item shows (<c>unplaced</c>).</summary>
    public static string Read(GH_Document document)
    {
        var bridge = Bridge(document, out var error);
        return bridge == null
            ? Result(false, error)
            : LayoutSpec.Read(Synced(bridge, document)).ToString(Formatting.Indented);
    }

    /// <summary>
    ///     Lays the form out as <paramref name="spec" /> says. Refuses the whole spec on any error, naming
    ///     each; nothing changes then.
    /// </summary>
    public static string Apply(GH_Document document, string spec)
    {
        var bridge = Bridge(document, out var error);
        if (bridge == null)
        {
            return Result(false, error);
        }

        JObject parsed;
        try
        {
            parsed = JObject.Parse(spec);
        }
        catch (JsonReaderException ex)
        {
            return Result(false, "The spec is not a JSON object: " + ex.Message);
        }

        LayoutSpec.Outcome outcome;
        try
        {
            outcome = LayoutSpec.Apply(Synced(bridge, document), parsed, (id, widget) => CanvasConfig(document, id, widget));
        }
        catch (Exception ex) when (ex is JsonException or ArgumentException or InvalidCastException)
        {
            return Result(false, "The spec could not be read: " + ex.Message);
        }

        if (outcome.Schema == null)
        {
            return Result(false, outcome.Errors.ToArray());
        }

        var schema = outcome.Schema;
        schema.DocumentId = document.DocumentID;
        schema.ProjectFileName = !string.IsNullOrEmpty(document.Properties?.ProjectFileName)
            ? document.Properties.ProjectFileName
            : !string.IsNullOrEmpty(document.FilePath) ? System.IO.Path.GetFileName(document.FilePath) : schema.ProjectFileName;
        schema.LastModified = DateTime.UtcNow;
        new SchemaSynchronizer("layout").ApplyParameterAccessFromSchema(schema, document);
        bridge.ApplyAuthoredSchema(schema);

        var result = JObject.Parse(Result(true));
        if (outcome.Unplaced.Count > 0)
        {
            result["unplaced"] = new JArray(outcome.Unplaced);
        }

        return result.ToString(Formatting.Indented);
    }

    private static GH_UIBuilderComponent Bridge(GH_Document document, out string error)
    {
        var bridges = document?.Objects.OfType<GH_UIBuilderComponent>().ToList();
        error = document == null ? "No document."
            : bridges.Count == 0 ? "The document has no UI Bridge."
            : bridges.Count > 1 ? $"The document has {bridges.Count} UI Bridges; a layout needs exactly one."
            : null;
        return error == null ? bridges[0] : null;
    }

    /// <summary>A copy brought up to the canvas: stale ids purged, new getters and bakes added.</summary>
    private static UISchema Synced(GH_UIBuilderComponent bridge, GH_Document document)
    {
        var schema = bridge.Schema != null
            ? LayoutSpec.Clone(bridge.Schema)
            : new UISchema { Id = Guid.NewGuid().ToString(), Name = document.DisplayName, Layout = new TabbedLayoutConfig() };
        var synchronizer = new SchemaSynchronizer("layout");
        synchronizer.ValidateSchema(schema, document);
        synchronizer.MergePostSolveBakeOutputs(schema, document);
        return schema;
    }

    private static JObject CanvasConfig(GH_Document document, Guid id, string widget)
    {
        var found = document.FindObject(id, false);
        if (widget == "dropdown" && found is GetValueListParameter list)
        {
            return new JObject { ["options"] = JObject.FromObject(list.Values) };
        }

        if (widget != "number" || found is not IGH_ContextualParameter param)
        {
            return null;
        }

        var range = new DiscoveredInput { Id = id };
        ParameterTypeHelper.ExtractNumberParameterConstraints(param, found as IGH_Param, range);
        var config = new JObject();
        if (range.Minimum is double minimum)
        {
            config["minimum"] = minimum;
        }

        if (range.Maximum is double maximum)
        {
            config["maximum"] = maximum;
        }

        if (range.StepSize is double step)
        {
            config["stepSize"] = step;
        }

        return config.HasValues ? config : null;
    }

    private static string Result(bool ok, params string[] errors)
    {
        var result = new JObject { ["ok"] = ok };
        if (errors.Length > 0)
        {
            result["errors"] = new JArray(errors.Cast<object>().ToArray());
        }

        return result.ToString(Formatting.Indented);
    }
}
