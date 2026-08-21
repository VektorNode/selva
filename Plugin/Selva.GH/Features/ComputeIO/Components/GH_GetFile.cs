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
using Rhino.Geometry;
using Selva.Schema.Models;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Point = Rhino.Geometry.Point;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that imports geometry from files (local path, URL, or base64).
///     Supported formats are defined in AcceptedFileFormats.Values (schema-driven).
/// </summary>
public class GetFileParameter : GH_Param<IGH_GeometricGoo>, IGH_ContextualParameter
{
    private const int MaxContextualDataItems = 100;
    private const int MaxFileDataSize = AppConfig.ValueLimits.MaxBase64StringLength;
    private const int MaxJsonDepth = AppConfig.JsonSerialization.MaxJsonDepth;
    private const int MaxPathLength = 32767; // Windows MAX_PATH

    private FileInputData _contextualFileData;
    private bool _isFromContextual;

    public GetFileParameter()
        : base("Get File", "Get File", "Import geometry from file (path, URL, or upload)", "Params", "Util",
            GH_ParamAccess.list)
    {
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;

    public override string TypeName => "File";
    public override Guid ComponentGuid => new Guid("B4F6E8D2-9A3C-4E7B-8D1F-5A9C7E2B4D6F");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.CreateFile);
    public bool TreeAccess { get; set; }

    // IGH_ContextualParameter properties
    public string Prompt { get; set; } = "Select a file to import";
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
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        "Too many contextual data items");
                    break;
                }

                var fileData = ExtractFileInputData(item);
                if (fileData != null)
                {
                    if (ValidateFileInputData(fileData))
                    {
                        _contextualFileData = fileData;
                        _isFromContextual = true;
                        break; // AtMost = 1
                    }

                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"File data validation failed. Size: {fileData.File?.Length ?? 0} chars (Max: {MaxFileDataSize})");
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error assigning contextual data: {ex.Message}");
        }

        ExpireSolution(false);
    }

    public bool AutoAssignContextualData(GH_ParameterContext context)
    {
        return _contextualFileData != null;
    }

    /// <summary>
    ///     Assigns contextual data as a tree — called by Rhino.Compute via reflection, which sends
    ///     DataTree of GH_String.
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
            // AtMost = 1: only the first item of the first path.
            var firstPath = data.Paths.FirstOrDefault();
            if (firstPath != null)
            {
                var branch = data.Branch(firstPath);
                if (branch != null && branch.Count > 0)
                {
                    var firstItem = branch[0];
                    var fileData = ExtractFileInputData(firstItem);

                    if (fileData != null && ValidateFileInputData(fileData))
                    {
                        _contextualFileData = fileData;
                        _isFromContextual = true;
                    }
                    else if (fileData != null)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                            $"File data validation failed. Size: {fileData.File?.Length ?? 0} chars (Max: {MaxFileDataSize})");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error assigning contextual data tree: {ex.Message}");
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
            ImportAndOutputGeometry(_contextualFileData);
        }
    }

    protected override void CollectVolatileData_FromSources()
    {
        m_data.Clear();

        // Priority 1: Contextual data from web UI (auto-import)
        if (_contextualFileData != null && _isFromContextual)
        {
            ImportAndOutputGeometry(_contextualFileData);
            return;
        }

        // Priority 2: Manual input from text/path component
        foreach (var source in Sources)
        {
            if (source == null)
            {
                continue;
            }

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

                if (firstItem == null)
                {
                    continue;
                }

                var fileData = ExtractFileInputData(firstItem);
                if (fileData != null)
                {
                    ImportAndOutputGeometry(fileData);
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

    private void ImportAndOutputGeometry(FileInputData fileData)
    {
        if (fileData == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No file data provided");
            return;
        }

        var result = FileImporter.ImportFromFileInputData(fileData);

        if (!result.Success)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, result.ErrorMessage);
            return;
        }

        if (result.Geometry.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry found in file");
            return;
        }

        // Convert to IGH_GeometricGoo
        var ghGeometry = new List<IGH_GeometricGoo>();

        foreach (var item in result.Geometry)
        {
            var geo = item.Geometry;
            if (geo == null)
            {
                continue;
            }

            IGH_GeometricGoo goo = geo switch
            {
                Curve curve => new GH_Curve(curve),
                Brep brep => new GH_Brep(brep),
                Mesh mesh => new GH_Mesh(mesh),
                Surface surface => new GH_Surface(surface),
                Point point => new GH_Point(point.Location),
                _ => null
            };

            if (goo != null)
            {
                ghGeometry.Add(goo);
            }
        }

        m_data.AppendRange(ghGeometry, new GH_Path(0));

        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Imported {ghGeometry.Count} objects from {result.DetectedFormat}");
    }

    private static FileInputData ExtractFileInputData(object item)
    {
        return item switch
        {
            null => null,
            FileInputGoo goo => goo.Value,
            FileInputData data => data,
            GH_String ghString => TryParseFileInputDataFromString(ghString.Value),
            IGH_Goo goo => TryParseFileInputDataFromString(goo.ScriptVariable()?.ToString()),
            string str => TryParseFileInputDataFromString(str),
            _ => null
        };
    }

    private static FileInputData TryParseFileInputDataFromString(string str)
    {
        if (string.IsNullOrEmpty(str))
        {
            return null;
        }

        if (str.Length > MaxFileDataSize)
        {
            return null;
        }

        try
        {
            var settings = new JsonSerializerSettings
            {
                MaxDepth = MaxJsonDepth,
                TypeNameHandling = TypeNameHandling.None // prevent type injection attacks
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
            if (str.Length > MaxPathLength)
            {
                return null;
            }

            return FileInputData.FromPath(str);
        }
        catch
        {
            return null;
        }
    }

    private static bool ValidateFileInputData(FileInputData fileData)
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
            if (!AcceptedFileFormats.Values.Contains(fileData.FileEnding.ToLowerInvariant()))
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
            Prompt = reader.GetString("Prompt") ?? "Select a file to import";

            var atLeast = 1;
            if (reader.TryGetInt32("AtLeast", ref atLeast))
            {
                AtLeast = atLeast;
            }

            var atMost = 1;
            if (reader.TryGetInt32("AtMost", ref atMost))
            {
                AtMost = atMost;
            }

            var treeAccess = false;
            if (reader.TryGetBoolean("TreeAccess", ref treeAccess))
            {
                TreeAccess = treeAccess;
            }

            var immediate = true;
            if (reader.TryGetBoolean("Immediate", ref immediate))
            {
                Immediate = immediate;
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error reading saved data: {ex.Message}");
        }

        return base.Read(reader);
    }
}
