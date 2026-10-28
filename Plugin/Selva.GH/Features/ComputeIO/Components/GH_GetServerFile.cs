using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Selva.FileIO;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.Schema.Models;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that imports geometry from a file relative to the compute
///     server's data directory.
///
///     The relative path (e.g. "geometry/bracket.3dm") is authored once on the definition;
///     the absolute base directory is supplied per server at solve time via contextual data,
///     so the same definition works against any server regardless of where its data lives.
///
///     The .gh is shared across a company, so it only ever stores the relative path —
///     absolute paths would break on a colleague's machine. To test before deploying, a
///     right-click "Pick local file…" menu item points the component at a real file on this
///     machine. That absolute path is a per-machine override, never persisted to the .gh, and
///     Selva-injected context always wins over it once present.
/// </summary>
public class GetServerFileParameter : SelvaContextualParameter<IGH_GeometricGoo>
{
    private const int MaxPathLength = 32767; // Windows MAX_PATH ceiling.

    // Persisted in the .gh; may also arrive from a wired source.
    private string _relativePath = string.Empty;

    // Set via the right-click menu; never persisted, never wins over Selva context.
    private string _localFilePath;

    // This collect's relative path: a wired source's, else the authored one.
    private string _collectRelativePath;

    public GetServerFileParameter()
        : base("Get Server File", "Get Server File",
            "Import geometry from a file relative to the server's data directory", GH_ParamAccess.list,
            "Server data path")
    {
    }

    public override string TypeName => "ServerFile";
    public override Guid ComponentGuid => new Guid("C8E1A7F4-2D63-4B95-9E08-7A1C5F3D6B92");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.CreateFile);

    /// <summary>Relative path to the file, e.g. "geometry/bracket.3dm".</summary>
    public string RelativePath
    {
        get => _relativePath;
        set => _relativePath = value ?? string.Empty;
    }

    // The base path comes from the server, never from the user, so there is nothing to ask.
    public override bool AutoAssignContextualData(GH_ParameterContext context)
    {
        return true;
    }

    protected override void BeforeCollect()
    {
        var sourcePath = Sources
            .Where(source => source is Param_FilePath or Param_String && source.VolatileData != null)
            .SelectMany(source => source.VolatileData.AllData(true))
            .Select(ExtractPathString)
            .FirstOrDefault(path => !string.IsNullOrWhiteSpace(path));
        _collectRelativePath = sourcePath ?? _relativePath;
    }

    protected override IEnumerable<IGH_GeometricGoo> FromContextual(object value)
    {
        var basePath = ExtractPathString(value);
        return string.IsNullOrWhiteSpace(basePath)
            ? Enumerable.Empty<IGH_GeometricGoo>()
            : ResolveAndImport(basePath, _collectRelativePath);
    }

    protected override void CollectFromSources()
    {
        m_data.AppendRange(ResolveAndImport(null, _collectRelativePath));
    }

    protected override void CollectWithoutSources()
    {
        m_data.AppendRange(ResolveAndImport(null, _collectRelativePath));
    }

    public override void AppendAdditionalMenuItems(ToolStripDropDown menu)
    {
        base.AppendAdditionalMenuItems(menu);

        Menu_AppendSeparator(menu);
        Menu_AppendItem(menu, "Pick local file…", OnPickLocalFile);

        if (!string.IsNullOrWhiteSpace(_localFilePath))
        {
            Menu_AppendItem(menu, $"Clear local file ({Path.GetFileName(_localFilePath)})", OnClearLocalFile);
        }
    }

    private void OnPickLocalFile(object sender, EventArgs e)
    {
        var filter = "Supported geometry|" + string.Join(";", AcceptedFileFormats.Values.Select(ext => "*" + ext));

        using var dialog = new OpenFileDialog
        {
            Title = "Pick a local file to test with",
            Filter = filter + "|All files|*.*",
            CheckFileExists = true
        };

        if (dialog.ShowDialog() == DialogResult.OK)
        {
            _localFilePath = dialog.FileName;
            ExpireSolution(true);
        }
    }

    private void OnClearLocalFile(object sender, EventArgs e)
    {
        _localFilePath = null;
        ExpireSolution(true);
    }

    /// <summary>
    ///     Resolves the file to import. The server data path wins whenever present; the
    ///     locally-picked file is only a fallback for testing before that context exists.
    /// </summary>
    private List<IGH_GeometricGoo> ResolveAndImport(string basePath, string relativePath)
    {
        var none = new List<IGH_GeometricGoo>();
        if (!string.IsNullOrWhiteSpace(basePath))
        {
            if (string.IsNullOrWhiteSpace(relativePath))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No relative file path set");
                return none;
            }

            string resolvedPath;
            try
            {
                resolvedPath = ServerFilePath.Resolve(basePath, relativePath);
            }
            catch (ArgumentException ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
                return none;
            }

            if (resolvedPath.Length > MaxPathLength)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Resolved path exceeds the maximum length");
                return none;
            }

            if (!File.Exists(resolvedPath))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"File not found on server: {resolvedPath}");
                return none;
            }

            return FileImporter.ImportAsGoo(FileInputData.FromPath(resolvedPath), AddRuntimeMessage);
        }

        if (!string.IsNullOrWhiteSpace(_localFilePath))
        {
            if (!File.Exists(_localFilePath))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Local file not found: {_localFilePath}");
                return none;
            }

            var imported = FileImporter.ImportAsGoo(FileInputData.FromPath(_localFilePath), AddRuntimeMessage);
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "Using local test file. Selva will resolve the relative path on the server.");
            return imported;
        }

        if (string.IsNullOrWhiteSpace(relativePath))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No relative file path set");
            return none;
        }

        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
            "No server data path provided. Solve over Selva to resolve relative to the server's data " +
            "directory, or right-click → \"Pick local file…\" to test on this machine.");
        return none;
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
        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        _relativePath = reader.ItemExists("RelativePath") ? reader.GetString("RelativePath") : string.Empty;
        return base.Read(reader);
    }
}
