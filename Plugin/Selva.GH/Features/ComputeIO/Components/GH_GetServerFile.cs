using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;
using Rhino.Geometry;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Point = Rhino.Geometry.Point;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that imports geometry from a file located relative to the
///     compute server's data directory.
///
///     The relative path (e.g. "geometry/bracket.3dm") is authored once on the definition —
///     baked into the component or wired from an upstream string source. The absolute base
///     directory is supplied per server at solve time via contextual data, so the same
///     definition works against any server regardless of where its data lives on disk.
///
///     Paths are resolved cross-platform: backslashes and forward slashes in the relative
///     path are normalised to the host separator, so a definition authored on Windows
///     resolves correctly on a Linux server and vice versa.
/// </summary>
public class GetServerFileParameter : GH_Param<IGH_GeometricGoo>, IGH_ContextualParameter
{
    private const int MaxContextualDataItems = 100;
    private const int MaxPathLength = 32767; // Windows MAX_PATH ceiling.

    // Author-set relative path, persisted in the .gh file. May also arrive from a wired source.
    private string _relativePath = string.Empty;

    // Server data directory, assigned at solve time (web UI / Rhino.Compute), never persisted.
    private string _serverDataPath;

    public GetServerFileParameter()
        : base("Get Server File", "Get Server File",
            "Import geometry from a file relative to the server's data directory", "Params", "Util",
            GH_ParamAccess.list)
    {
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;

    public override string TypeName => "ServerFile";
    public override Guid ComponentGuid => new Guid("C8E1A7F4-2D63-4B95-9E08-7A1C5F3D6B92");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.CreateFile);
    public bool TreeAccess { get; set; }

    /// <summary>Author-set relative path to the file, e.g. "geometry/bracket.3dm".</summary>
    public string RelativePath
    {
        get => _relativePath;
        set => _relativePath = value ?? string.Empty;
    }

    // IGH_ContextualParameter properties
    public string Prompt { get; set; } = "Server data path";
    public int AtLeast { get; set; } = 1;
    public int AtMost { get; set; } = 1;
    public bool Immediate { get; set; } = true;

    public IEnumerable<object> ContextualData
    {
        get
        {
            if (!string.IsNullOrEmpty(_serverDataPath))
            {
                yield return new GH_String(_serverDataPath);
            }
        }
    }

    /// <summary>
    ///     Receives the server data path from the web UI. Only the base directory comes
    ///     through here — the relative path is part of the definition.
    /// </summary>
    public void AssignContextualData(IEnumerable data)
    {
        _serverDataPath = null;

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

                var path = ExtractPathString(item);
                if (!string.IsNullOrWhiteSpace(path))
                {
                    _serverDataPath = path;
                    break; // AtMost = 1
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
        return !string.IsNullOrEmpty(_serverDataPath);
    }

    /// <summary>
    ///     Assigns the server data path as a tree — called by Rhino.Compute via reflection.
    ///     Takes the first item of the first path (AtMost = 1).
    /// </summary>
    public void AssignContextualDataTree(DataTree<GH_String> data)
    {
        _serverDataPath = null;

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
                    var path = ExtractPathString(branch[0]);
                    if (!string.IsNullOrWhiteSpace(path))
                    {
                        _serverDataPath = path;
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
        _serverDataPath = null;
    }

    /// <summary>
    ///     Returns contextual JSON for web UI schema discovery. The discovered input is a
    ///     server-supplied path, distinct from a user-facing file picker.
    /// </summary>
    public JObject GetContextualJson()
    {
        return new JObject
        {
            { "description", Description ?? "" },
            { "name", Name },
            { "nickname", NickName },
            { "treeAccess", Access == GH_ParamAccess.tree },
            { "paramType", "serverDataPath" }
        };
    }

    protected override void CollectVolatileData_Custom()
    {
        m_data.Clear();
        ResolveAndImport(_serverDataPath, _relativePath);
    }

    protected override void CollectVolatileData_FromSources()
    {
        m_data.Clear();

        // The relative path may be wired from an upstream string source instead of baked in.
        var relativePath = _relativePath;
        var sourcePath = ReadFirstStringFromSources();
        if (!string.IsNullOrWhiteSpace(sourcePath))
        {
            relativePath = sourcePath;
        }

        ResolveAndImport(_serverDataPath, relativePath);
    }

    /// <summary>
    ///     Joins the server base path with the relative path and imports the geometry.
    /// </summary>
    private void ResolveAndImport(string basePath, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No relative file path set");
            return;
        }

        if (string.IsNullOrWhiteSpace(basePath))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "No server data path provided. This component resolves files relative to the server's data directory.");
            return;
        }

        string resolvedPath;
        try
        {
            resolvedPath = ServerFilePath.Resolve(basePath, relativePath);
        }
        catch (ArgumentException ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            return;
        }

        if (resolvedPath.Length > MaxPathLength)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Resolved path exceeds the maximum length");
            return;
        }

        if (!File.Exists(resolvedPath))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"File not found on server: {resolvedPath}");
            return;
        }

        ImportAndOutputGeometry(FileInputData.FromPath(resolvedPath));
    }

    /// <summary>
    ///     Imports geometry from FileInputData and outputs it to m_data.
    /// </summary>
    private void ImportAndOutputGeometry(FileInputData fileData)
    {
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

    /// <summary>
    ///     Reads the first non-empty string from wired sources (relative path override).
    /// </summary>
    private string ReadFirstStringFromSources()
    {
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

                var path = ExtractPathString(firstItem);
                if (!string.IsNullOrWhiteSpace(path))
                {
                    return path;
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Error reading from source '{source.NickName}': {ex.Message}");
            }
        }

        return null;
    }

    private static string ExtractPathString(object item)
    {
        return item switch
        {
            null => null,
            string str => str,
            GH_String ghString => ghString.Value,
            IGH_Goo goo => goo.ScriptVariable()?.ToString(),
            _ => item.ToString()
        };
    }

    public override bool Write(GH_IWriter writer)
    {
        writer.SetString("RelativePath", _relativePath ?? string.Empty);
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
            _relativePath = reader.ItemExists("RelativePath") ? reader.GetString("RelativePath") : string.Empty;
            Prompt = reader.GetString("Prompt") ?? "Server data path";

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
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error reading saved data: {ex.Message}");
        }

        return base.Read(reader);
    }
}
