using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///   A contextual parameter that accepts a color from the web UI.
///   Colors are transferred as hex strings (e.g. "#FF5733") and converted to GH_Colour.
/// </summary>
public class GetColorParameter : GH_Param<GH_Colour>, IGH_ContextualParameter
{
    private GH_Colour _contextualColor;
    private bool _isFromContextual;

    public GetColorParameter()
        : base("Get Color", "Get Color", "Import a color from the web UI", "Params", "Util",
            GH_ParamAccess.item)
    {
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;

    public override string TypeName => "Color";
    public override Guid ComponentGuid => new("C3A7F1D4-8E2B-4F6A-9C5D-1B3E7A4F8D2C");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.DataToFile);

    // IGH_ContextualParameter properties
    public string Prompt { get; set; } = "Select a color";
    public int AtLeast { get; set; } = 1;
    public int AtMost { get; set; } = 1;
    public bool Immediate { get; set; } = true;
    public bool TreeAccess { get; set; }

    public IEnumerable<object> ContextualData
    {
        get
        {
            if (_contextualColor != null) yield return _contextualColor;
        }
    }

    public void AssignContextualData(IEnumerable data)
    {
        _contextualColor = null;

        if (data == null)
        {
            ExpireSolution(false);
            return;
        }

        try
        {
            foreach (var item in data)
            {
                var color = ExtractColor(item);
                if (color != null)
                {
                    _contextualColor = color;
                    _isFromContextual = true;
                    break; // AtMost = 1
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error assigning contextual color data: {ex.Message}");
        }

        ExpireSolution(false);
    }

    /// <summary>
    ///   Assigns contextual data as a tree - called by Rhino.Compute via reflection.
    /// </summary>
    public void AssignContextualDataTree(DataTree<GH_String> data)
    {
        _contextualColor = null;

        if (data == null || data.BranchCount == 0)
        {
            ExpireSolution(false);
            return;
        }

        try
        {
            var firstPath = data.Paths.FirstOrDefault();
            if (firstPath != null)
            {
                var branch = data.Branch(firstPath);
                if (branch != null && branch.Count > 0)
                {
                    var color = ExtractColor(branch[0]);
                    if (color != null)
                    {
                        _contextualColor = color;
                        _isFromContextual = true;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error assigning contextual color tree: {ex.Message}");
        }

        ExpireSolution(false);
    }

    public bool AutoAssignContextualData(GH_ParameterContext context)
    {
        return _contextualColor != null;
    }

    public void ClearContextualData()
    {
        _contextualColor = null;
        _isFromContextual = false;
    }

    /// <summary>
    ///   Returns contextual JSON for web UI schema discovery.
    /// </summary>
    public JObject GetContextualJson()
    {
        return new JObject
        {
            { "description", Description ?? "" },
            { "name", Name },
            { "nickname", NickName },
            { "paramType", "color" },
            { "treeAccess", Access == GH_ParamAccess.tree }
        };
    }

    protected override void CollectVolatileData_Custom()
    {
        m_data.Clear();

        if (_contextualColor != null && _isFromContextual)
            m_data.Append(_contextualColor, new GH_Path(0));
    }

    protected override void CollectVolatileData_FromSources()
    {
        m_data.Clear();

        if (_contextualColor != null && _isFromContextual)
        {
            m_data.Append(_contextualColor, new GH_Path(0));
            return;
        }

        // Fallback: collect from wired sources normally
        base.CollectVolatileData_FromSources();
    }

    /// <summary>
    ///   Extracts a GH_Colour from various input types.
    ///   Accepts hex strings like "#FF5733" or GH_Colour directly.
    /// </summary>
    private static GH_Colour ExtractColor(object item)
    {
        return item switch
        {
            null => null,
            GH_Colour ghColor => ghColor,
            GH_String ghString => ParseHexToColor(ghString.Value),
            string str => ParseHexToColor(str),
            IGH_Goo goo => ParseHexToColor(goo.ScriptVariable()?.ToString()),
            _ => null
        };
    }

    /// <summary>
    ///   Parses a hex color string (e.g. "#FF5733") into a GH_Colour.
    /// </summary>
    private static GH_Colour ParseHexToColor(string hex)
    {
        if (string.IsNullOrWhiteSpace(hex)) return null;

        try
        {
            var color = ColorTranslator.FromHtml(hex);
            return new GH_Colour(color);
        }
        catch
        {
            return null;
        }
    }

    public override bool Write(GH_IWriter writer)
    {
        writer.SetString("Prompt", Prompt ?? string.Empty);
        writer.SetInt32("AtLeast", AtLeast);
        writer.SetInt32("AtMost", AtMost);
        writer.SetBoolean("TreeAccess", TreeAccess);
        writer.SetBoolean("Immediate", Immediate);

        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        try
        {
            Prompt = reader.GetString("Prompt") ?? "Select a color";

            var atLeast = 1;
            if (reader.TryGetInt32("AtLeast", ref atLeast)) AtLeast = atLeast;

            var atMost = 1;
            if (reader.TryGetInt32("AtMost", ref atMost)) AtMost = atMost;

            var treeAccess = false;
            if (reader.TryGetBoolean("TreeAccess", ref treeAccess)) TreeAccess = treeAccess;

            var immediate = true;
            if (reader.TryGetBoolean("Immediate", ref immediate)) Immediate = immediate;
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error reading saved color data: {ex.Message}");
        }

        return base.Read(reader);
    }

}
