using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that supplies an image (PNG/JPEG/WEBP/SVG) from the web UI as a
///     FileInputGoo (path, URL, or base64). Unlike Get File this does no Rhino import — it
///     carries the raw image payload downstream, where Draw Image turns it into an ImageElement.
/// </summary>
public class GetImageParameter : GH_Param<FileInputGoo>, IGH_ContextualParameter
{
    private const int MaxContextualDataItems = 100;
    private const int MaxFileDataSize = AppConfig.ValueLimits.MaxBase64StringLength;
    private const int MaxJsonDepth = AppConfig.JsonSerialization.MaxJsonDepth;
    private const int MaxPathLength = 32767;

    private FileInputData _contextualFileData;
    private bool _isFromContextual;

    public GetImageParameter()
        : base("Get Image", "Get Image", "Supply an image from the web UI (path, URL, or upload)", "Params", "Util",
            GH_ParamAccess.item)
    {
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;

    public override string TypeName => "Image";
    public override Guid ComponentGuid => new Guid("D7A2F4C8-3B6E-4A91-8C5D-2E9F7B1A6D04");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.CreateFile);
    public bool TreeAccess { get; set; }

    public string Prompt { get; set; } = "Select an image";
    public int AtLeast { get; set; } = 1;
    public int AtMost { get; set; } = 1;
    public bool Immediate { get; set; } = true;

    public IEnumerable<object> ContextualData
    {
        get
        {
            if (_contextualFileData != null)
            {
                yield return new FileInputGoo(_contextualFileData);
            }
        }
    }

    public void AssignContextualData(IEnumerable data)
    {
        _contextualFileData = null;

        if (data == null)
        {
            ExpireSolution(false);
            return;
        }

        try
        {
            var count = 0;
            foreach (var item in data)
            {
                if (++count > MaxContextualDataItems)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Too many contextual data items");
                    break;
                }

                var fileData = ExtractFileInputData(item);
                if (fileData != null)
                {
                    if (ValidateImageInputData(fileData))
                    {
                        _contextualFileData = fileData;
                        _isFromContextual = true;
                        break; // AtMost = 1
                    }

                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Image data validation failed. Size: {fileData.File?.Length ?? 0} chars (Max: {MaxFileDataSize})");
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error assigning contextual data: {ex.Message}");
        }

        ExpireSolution(false);
    }

    public bool AutoAssignContextualData(GH_ParameterContext context)
    {
        return _contextualFileData != null;
    }

    /// <summary>
    ///     Assigns contextual data as a tree — called by Rhino.Compute via reflection.
    /// </summary>
    public void AssignContextualDataTree(DataTree<GH_String> data)
    {
        _contextualFileData = null;

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
                    var fileData = ExtractFileInputData(branch[0]);
                    if (fileData != null && ValidateImageInputData(fileData))
                    {
                        _contextualFileData = fileData;
                        _isFromContextual = true;
                    }
                    else if (fileData != null)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                            $"Image data validation failed. Size: {fileData.File?.Length ?? 0} chars (Max: {MaxFileDataSize})");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error assigning contextual data tree: {ex.Message}");
        }

        ExpireSolution(false);
    }

    public void ClearContextualData()
    {
        _contextualFileData = null;
        _isFromContextual = false;
    }

    protected override void CollectVolatileData_Custom()
    {
        m_data.Clear();

        if (_contextualFileData != null && _isFromContextual)
        {
            OutputImage(_contextualFileData);
        }
    }

    protected override void CollectVolatileData_FromSources()
    {
        m_data.Clear();

        // Priority 1: contextual data from the web UI.
        if (_contextualFileData != null && _isFromContextual)
        {
            OutputImage(_contextualFileData);
            return;
        }

        // Priority 2: manual input from a path / string component.
        foreach (var source in Sources)
        {
            if (source == null) continue;

            try
            {
                IGH_Goo firstItem = null;

                if (source is Param_FilePath filePathParam)
                {
                    var persistentData = filePathParam.PersistentData;
                    if (persistentData != null && !persistentData.IsEmpty)
                    {
                        firstItem = persistentData.AllData(true).FirstOrDefault();
                    }
                }
                else if (source is Param_String stringParam)
                {
                    var persistentData = stringParam.PersistentData;
                    if (persistentData != null && !persistentData.IsEmpty)
                    {
                        firstItem = persistentData.AllData(true).FirstOrDefault();
                    }
                    else
                    {
                        var volatileData = stringParam.VolatileData;
                        if (volatileData != null && !volatileData.IsEmpty)
                        {
                            firstItem = volatileData.AllData(true).FirstOrDefault();
                        }
                    }
                }
                else if (source.VolatileData != null && !source.VolatileData.IsEmpty)
                {
                    firstItem = source.VolatileData.AllData(true).FirstOrDefault();
                }

                if (firstItem == null) continue;

                var fileData = ExtractFileInputData(firstItem);
                if (fileData != null)
                {
                    OutputImage(fileData);
                    return;
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Error reading from source '{source.NickName}': {ex.Message}");
            }
        }
    }

    private void OutputImage(FileInputData fileData)
    {
        if (fileData == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No image data provided");
            return;
        }

        m_data.Append(new FileInputGoo(fileData), new GH_Path(0));
    }

    private static FileInputData ExtractFileInputData(object item)
    {
        return item switch
        {
            null => null,
            FileInputGoo goo => goo.Value,
            FileInputData data => data,
            GH_String ghString => TryParseFromString(ghString.Value),
            IGH_Goo goo => TryParseFromString(goo.ScriptVariable()?.ToString()),
            string str => TryParseFromString(str),
            _ => null
        };
    }

    private static FileInputData TryParseFromString(string str)
    {
        if (string.IsNullOrEmpty(str) || str.Length > MaxFileDataSize)
        {
            return null;
        }

        try
        {
            var settings = new JsonSerializerSettings
            {
                MaxDepth = MaxJsonDepth,
                TypeNameHandling = TypeNameHandling.None
            };

            var data = JsonConvert.DeserializeObject<FileInputData>(str, settings);
            if (data != null && !string.IsNullOrEmpty(data.File))
            {
                if (data.Type != null)
                {
                    var validTypes = new[] { "path", "url", "base64" };
                    if (!validTypes.Contains(data.Type.ToLowerInvariant()))
                    {
                        return null;
                    }
                }

                return data;
            }
        }
        catch (JsonException)
        {
            // Not JSON — treat as a path.
        }
        catch (Exception)
        {
            return null;
        }

        try
        {
            if (str.Length > MaxPathLength) return null;
            return FileInputData.FromPath(str);
        }
        catch
        {
            return null;
        }
    }

    private static bool ValidateImageInputData(FileInputData fileData)
    {
        if (fileData == null || string.IsNullOrWhiteSpace(fileData.File))
        {
            return false;
        }

        if (fileData.File.Length > MaxFileDataSize)
        {
            return false;
        }

        if (fileData.Type != null)
        {
            var validTypes = new[] { "path", "url", "base64" };
            if (!validTypes.Contains(fileData.Type.ToLowerInvariant()))
            {
                return false;
            }
        }

        if (fileData.FileEnding != null)
        {
            if (!ImageInputResolver.AcceptedFormats.Contains(fileData.FileEnding.ToLowerInvariant()))
            {
                return false;
            }
        }

        return true;
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
            Prompt = reader.GetString("Prompt") ?? "Select an image";

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
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error reading saved data: {ex.Message}");
        }

        return base.Read(reader);
    }
}
