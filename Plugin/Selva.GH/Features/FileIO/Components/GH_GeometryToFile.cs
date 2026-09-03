using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;
using Point = Rhino.Geometry.Point;

namespace Selva.GH.Features.FileIO.Components;

/// <summary>
///     Exports geometry to file format(s) with layer organization.
///     Task-capable: the export runs on a background task and writes output files in parallel, so a
///     tree of many parts doesn't serialize on the UI thread. See <see cref="Export" /> for why only
///     the .3dm path is backgrounded.
/// </summary>
public class GH_GeometryToFile : GH_TaskCapableComponent<GH_GeometryToFile.ExportResult>, ISelvaFileOutput
{
    private const string DefaultLayerName = "Default";
    private const string DefaultFileEnding = ".3dm";

    /// <summary>Rhino file version written by the .3dm path (matches the previous SaveAs default).</summary>
    private const int RhinoFileVersion = 7;

    private static readonly Color DefaultLayerColor = Color.Black;

    private static RhinoDocumentConverter _converter;
    private static readonly object _converterLock = new object();

    public GH_GeometryToFile()
        : base("Geometry To File", "GTF",
            "Exports geometry to file format(s) with layer organization. Supports both single file (list input) and multiple files (tree input).",
            "Selva", "IO")
    {
        EnsureConverterInitialized();
    }

    protected override Bitmap Icon => Resources.GeometryToFile;

    /// <summary>Do not change this GUID after release: it's the component's wire identity.</summary>
    public override Guid ComponentGuid => new Guid("4B2646E6-A8B0-48B6-A566-FE5EC2376C82");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    private void EnsureConverterInitialized()
    {
        if (_converter == null)
        {
            lock (_converterLock)
            {
                if (_converter == null)
                {
                    var options = new RhinoConverterOptions();
                    _converter = new RhinoDocumentConverter(options);
                }
            }
        }
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGeometryParameter("Geometry", "G",
            "Geometry to be exported. Use list for single file, tree for multiple files (one per branch)",
            GH_ParamAccess.tree);
        pManager.AddTextParameter("Layer Names", "L",
            "Names of the layers. Use list for single file, tree for multiple files",
            GH_ParamAccess.tree);
        pManager.AddColourParameter("Layer Colors", "C",
            "Colors of the layers. Use list for single file, tree for multiple files",
            GH_ParamAccess.tree);
        pManager.AddTextParameter("File Names", "F",
            "Name(s) of the file. Use single value for list input, or tree for multiple files",
            GH_ParamAccess.tree);
        pManager.AddTextParameter("File Ending", "E",
            "File ending of the geometry",
            GH_ParamAccess.item, DefaultFileEnding);
        pManager.AddTextParameter("Sub Folder", "Folder",
            "Optional subfolder for this file. Use :: to nest, like Rhino layers (ROOT::Panels). Files sharing a root land in the same folder; different roots produce separate top-level folders in the download.",
            GH_ParamAccess.item, "");
        pManager.AddTextParameter("Metadata", "M",
            "Optional metadata as \"key=value\" lines (e.g. author=felix). Applied to every exported file for downstream tagging/indexing.",
            GH_ParamAccess.list);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F",
            "Exported file data. Single item for list input, multiple items for tree input",
            GH_ParamAccess.list);
    }

    /// <summary>
    ///     All inputs are read as trees, so this runs once per solve and queues a single background
    ///     task; the per-file fan-out happens inside <see cref="Export" />.
    /// </summary>
    protected override void SolveInstance(IGH_DataAccess DA)
    {
        if (!DA.GetDataTree(0, out GH_Structure<IGH_GeometricGoo> geometryTree))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry provided");
            return;
        }

        DA.GetDataTree(1, out GH_Structure<GH_String> layerNamesTree);
        DA.GetDataTree(2, out GH_Structure<GH_Colour> layerColorsTree);

        if (!DA.GetDataTree(3, out GH_Structure<GH_String> fileNamesTree))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "File name(s) not provided");
            return;
        }

        var fileEnding = DefaultFileEnding;
        DA.GetData(4, ref fileEnding);

        var subFolder = "";
        DA.GetData(5, ref subFolder);

        var metadataLines = new List<string>();
        DA.GetDataList(6, metadataLines);
        var metadata = FileMetadataParser.Parse(metadataLines);

        if (string.IsNullOrWhiteSpace(fileEnding) || !fileEnding.StartsWith("."))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Invalid file ending '{fileEnding}'. Using default {DefaultFileEnding}");
            fileEnding = DefaultFileEnding;
        }

        if (InPreSolve)
        {
            // Only .3dm is safe to run off the UI thread: see Export. Other formats skip the
            // task and get computed inline on the main thread in the second pass below.
            if (IsRhinoFile(fileEnding))
            {
                var cancel = CancelToken;
                TaskList.Add(Task.Run(
                    () => Export(geometryTree, layerNamesTree, layerColorsTree, fileNamesTree,
                        fileEnding, subFolder, metadata, cancel),
                    cancel));
            }

            return;
        }

        if (!GetSolveResults(DA, out var result))
        {
            result = Export(geometryTree, layerNamesTree, layerColorsTree, fileNamesTree,
                fileEnding, subFolder, metadata, CancellationToken.None);
        }

        foreach (var (level, text) in result.Messages)
        {
            AddRuntimeMessage(level, text);
        }

        if (result.Files.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No files were successfully created");
            return;
        }

        DA.SetDataList(0, result.Files);
    }

    /// <summary>
    ///     Runtime messages cannot be raised from a worker thread, so the background pass collects
    ///     them here alongside the files and SolveInstance replays them once the task is joined.
    /// </summary>
    public sealed class ExportResult
    {
        public List<FileDataGoo> Files { get; } = new List<FileDataGoo>();

        public List<(GH_RuntimeMessageLevel Level, string Text)> Messages { get; } =
            new List<(GH_RuntimeMessageLevel, string)>();
    }

    /// <summary>One geometry destined for an exported file, with its layer already resolved.</summary>
    private struct JobItem
    {
        public GeometryBase Geometry;
        public string LayerName;
        public Color LayerColor;
    }

    /// <summary>
    ///     One output file. <see cref="Label" /> is the branch suffix used in runtime messages
    ///     (empty in single-file mode) so a warning still points at the branch it came from.
    /// </summary>
    private sealed class FileJob
    {
        public string FileName;
        public string Label;
        public List<JobItem> Items;
    }

    private static bool IsRhinoFile(string fileEnding)
    {
        return string.Equals(fileEnding, ".3dm", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    ///     Builds every output file. .3dm is written with <see cref="File3dm" />, an in-memory model
    ///     that touches neither the document table nor the disk, so files are written concurrently.
    ///     Every other format needs RhinoDoc.Export, which drives Rhino's file-format plugins; those
    ///     are not thread-safe, so that path stays serial (and on the main thread, see SolveInstance).
    /// </summary>
    private static ExportResult Export(
        GH_Structure<IGH_GeometricGoo> geometryTree,
        GH_Structure<GH_String> layerNamesTree,
        GH_Structure<GH_Colour> layerColorsTree,
        GH_Structure<GH_String> fileNamesTree,
        string fileEnding,
        string subFolder,
        Dictionary<string, string> metadata,
        CancellationToken cancel)
    {
        var result = new ExportResult();

        List<FileJob> jobs;
        try
        {
            jobs = BuildJobs(geometryTree, layerNamesTree, layerColorsTree, fileNamesTree, result.Messages);
        }
        catch (Exception ex)
        {
            result.Messages.Add((GH_RuntimeMessageLevel.Error, $"Error processing geometry: {ex.Message}"));
            return result;
        }

        if (jobs.Count == 0)
        {
            return result;
        }

        // Per-job slots keep the output (and its messages) in branch order regardless of the order
        // the parallel pass finishes in.
        var outputs = new FileDataGoo[jobs.Count];
        var messages = new List<(GH_RuntimeMessageLevel, string)>[jobs.Count];

        if (IsRhinoFile(fileEnding))
        {
            var options = new ParallelOptions
            {
                CancellationToken = cancel,
                MaxDegreeOfParallelism = Math.Max(1, System.Environment.ProcessorCount - 1)
            };

            try
            {
                Parallel.For(0, jobs.Count, options, i =>
                {
                    messages[i] = new List<(GH_RuntimeMessageLevel, string)>();
                    outputs[i] = WriteRhinoFile(jobs[i], fileEnding, subFolder, metadata, messages[i]);
                });
            }
            catch (OperationCanceledException)
            {
                return result;
            }
        }
        else
        {
            for (var i = 0; i < jobs.Count; i++)
            {
                if (cancel.IsCancellationRequested)
                {
                    return result;
                }

                messages[i] = new List<(GH_RuntimeMessageLevel, string)>();
                outputs[i] = ExportViaHeadlessDoc(jobs[i], fileEnding, subFolder, metadata, messages[i]);
            }
        }

        for (var i = 0; i < jobs.Count; i++)
        {
            if (messages[i] != null)
            {
                result.Messages.AddRange(messages[i]);
            }

            if (outputs[i] != null)
            {
                result.Files.Add(outputs[i]);
            }
        }

        return result;
    }

    /// <summary>
    ///     Flattens the input trees into one job per output file, resolving each item's layer up
    ///     front. Geometry extraction touches GH_Goo wrappers, so it stays in this sequential pass;
    ///     only the file writing that follows runs in parallel.
    /// </summary>
    private static List<FileJob> BuildJobs(
        GH_Structure<IGH_GeometricGoo> geometryTree,
        GH_Structure<GH_String> layerNamesTree,
        GH_Structure<GH_Colour> layerColorsTree,
        GH_Structure<GH_String> fileNamesTree,
        List<(GH_RuntimeMessageLevel Level, string Text)> messages)
    {
        var jobs = new List<FileJob>();

        if (IsSingleFileMode(geometryTree))
        {
            var allGeometry = geometryTree.AllData(true).OfType<IGH_GeometricGoo>().ToList();
            var allLayerNames = layerNamesTree?.AllData(true)
                .Select(s => (s as GH_String)?.Value)
                .ToList() ?? new List<string>();
            var allLayerColors = layerColorsTree?.AllData(true)
                .Select(c => (c as GH_Colour)?.Value ?? DefaultLayerColor)
                .ToList() ?? new List<Color>();
            var allFileNames = fileNamesTree?.AllData(true)
                .Select(s => (s as GH_String)?.Value)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList() ?? new List<string>();

            if (allGeometry.Count == 0)
            {
                messages.Add((GH_RuntimeMessageLevel.Warning, "No geometry found"));
                return jobs;
            }

            var items = BuildItems(allGeometry, allLayerNames, allLayerColors, "", messages);

            if (items.Count == 0)
            {
                messages.Add((GH_RuntimeMessageLevel.Error, "No valid geometry found to export"));
                return jobs;
            }

            jobs.Add(new FileJob
            {
                FileName = Path.GetFileNameWithoutExtension(allFileNames.FirstOrDefault() ?? "export"),
                Label = "",
                Items = items
            });

            return jobs;
        }

        var paths = geometryTree.Paths.ToList();

        for (var pathIndex = 0; pathIndex < paths.Count; pathIndex++)
        {
            var path = paths[pathIndex];
            var geometryBranch = geometryTree.get_Branch(path);

            if (geometryBranch == null || geometryBranch.Count == 0)
            {
                continue;
            }

            var label = $" in branch {path}";

            try
            {
                var branchGeometry = geometryBranch.OfType<IGH_GeometricGoo>().ToList();
                var branchLayerNames = layerNamesTree?.get_Branch(path)?.Cast<GH_String>()
                    .Select(s => s?.Value)
                    .ToList() ?? new List<string>();
                var branchLayerColors = layerColorsTree?.get_Branch(path)?.Cast<GH_Colour>()
                    .Select(c => c?.Value ?? DefaultLayerColor)
                    .ToList() ?? new List<Color>();
                var branchFileNames = fileNamesTree?.get_Branch(path)?.Cast<GH_String>()
                    .Select(s => s?.Value)
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .ToList() ?? new List<string>();

                var items = BuildItems(branchGeometry, branchLayerNames, branchLayerColors, label, messages);

                if (items.Count == 0)
                {
                    messages.Add((GH_RuntimeMessageLevel.Warning, $"No valid geometry found in branch {path}"));
                    continue;
                }

                jobs.Add(new FileJob
                {
                    FileName = Path.GetFileNameWithoutExtension(
                        branchFileNames.FirstOrDefault() ?? $"export_{pathIndex}"),
                    Label = label,
                    Items = items
                });
            }
            catch (Exception ex)
            {
                messages.Add((GH_RuntimeMessageLevel.Warning, $"Error processing branch {path}: {ex.Message}"));
            }
        }

        return jobs;
    }

    private static bool IsSingleFileMode(GH_Structure<IGH_GeometricGoo> geometryTree)
    {
        return geometryTree.PathCount == 1 ||
               (geometryTree.PathCount > 1 && geometryTree.Branches.Skip(1).All(b => b.Count == 0));
    }

    /// <summary>
    ///     Extracts valid GeometryBase objects from an IGH_GeometricGoo list and pairs each with its
    ///     layer. Layers are resolved against the goo's index in the original list, so a null or
    ///     unconvertible item does not shift the layer assignment of the items after it.
    /// </summary>
    private static List<JobItem> BuildItems(
        List<IGH_GeometricGoo> gooList,
        List<string> layerNames,
        List<Color> layerColors,
        string label,
        List<(GH_RuntimeMessageLevel Level, string Text)> messages)
    {
        var items = new List<JobItem>(gooList.Count);

        for (var i = 0; i < gooList.Count; i++)
        {
            var goo = gooList[i];

            if (goo == null)
            {
                continue;
            }

            GeometryBase geometry = null;

            try
            {
                var scriptVar = goo.ScriptVariable();
                if (scriptVar is GeometryBase geomBase)
                {
                    geometry = geomBase;
                }
                else if (goo is GH_Mesh ghMesh && ghMesh.Value != null)
                {
                    geometry = ghMesh.Value;
                }
                else if (goo is GH_Brep ghBrep && ghBrep.Value != null)
                {
                    geometry = ghBrep.Value;
                }
                else if (goo is GH_Surface ghSurface && ghSurface.Value != null)
                {
                    geometry = ghSurface.Value;
                }
                else if (goo is GH_Curve ghCurve && ghCurve.Value != null)
                {
                    geometry = ghCurve.Value;
                }
                else if (goo is GH_Box ghBox && ghBox.Value.IsValid)
                {
                    geometry = ghBox.Value.ToBrep();
                }
                else if (goo is GH_Point ghPoint)
                {
                    geometry = new Point(ghPoint.Value);
                }
                else if (goo is GH_Line ghLine && ghLine.Value.IsValid)
                {
                    geometry = new LineCurve(ghLine.Value);
                }
                else if (goo is GH_Circle ghCircle && ghCircle.Value.IsValid)
                {
                    geometry = new ArcCurve(ghCircle.Value);
                }
                else if (goo is GH_Arc ghArc && ghArc.Value.IsValid)
                {
                    geometry = new ArcCurve(ghArc.Value);
                }

                if (geometry != null && geometry.IsValid)
                {
                    items.Add(new JobItem
                    {
                        Geometry = geometry,
                        LayerName = GetLayerName(layerNames, i),
                        LayerColor = GetLayerColor(layerColors, i)
                    });
                }
            }
            catch (Exception ex)
            {
                messages.Add((GH_RuntimeMessageLevel.Warning,
                    $"Error extracting geometry at index {i}{label}: {ex.Message}"));
            }
        }

        return items;
    }

    /// <summary>
    ///     Writes one job to a .3dm as an in-memory model. File3dm never registers with the document
    ///     table and never touches disk, which is what makes this callable from several threads at
    ///     once and what removes the temp-file write/read round trip per file.
    /// </summary>
    private static FileDataGoo WriteRhinoFile(
        FileJob job,
        string fileEnding,
        string subFolder,
        Dictionary<string, string> metadata,
        List<(GH_RuntimeMessageLevel Level, string Text)> messages)
    {
        try
        {
            byte[] bytes;

            using (var model = new File3dm())
            {
                var layerCache = new Dictionary<string, int>();

                foreach (var item in job.Items)
                {
                    if (!layerCache.TryGetValue(item.LayerName, out var layerIndex))
                    {
                        layerIndex = model.AllLayers.AddLayer(item.LayerName, item.LayerColor);

                        if (layerIndex == RhinoMath.UnsetIntIndex)
                        {
                            messages.Add((GH_RuntimeMessageLevel.Warning,
                                $"Failed to create layer '{item.LayerName}'{job.Label}"));
                            continue;
                        }

                        layerCache[item.LayerName] = layerIndex;
                    }

                    model.Objects.Add(item.Geometry, new ObjectAttributes
                    {
                        LayerIndex = layerIndex,
                        Name = item.LayerName
                    });
                }

                bytes = model.ToByteArray(new File3dmWriteOptions { Version = RhinoFileVersion });
            }

            if (bytes == null || bytes.Length == 0)
            {
                messages.Add((GH_RuntimeMessageLevel.Error, $"Failed to export file '{job.FileName}'{job.Label}"));
                return null;
            }

            if (bytes.Length > AppConfig.ValueLimits.MaxFileSizeBytes)
            {
                messages.Add((GH_RuntimeMessageLevel.Error,
                    $"File '{job.FileName}' size ({bytes.Length:N0} bytes) exceeds maximum allowed ({AppConfig.ValueLimits.MaxFileSizeBytes:N0} bytes)"));
                return null;
            }

            // Echo the caller's spelling of the extension rather than a normalized ".3dm": the
            // client builds the download name as FileName + FileType.
            return BuildFileData(job.FileName, Convert.ToBase64String(bytes), fileEnding, subFolder, metadata);
        }
        catch (Exception ex)
        {
            messages.Add((GH_RuntimeMessageLevel.Error, $"Error during file export{job.Label}: {ex.Message}"));
            return null;
        }
    }

    /// <summary>Writes one job through a headless RhinoDoc and Rhino's exporters: see <see cref="Export" />.</summary>
    private static FileDataGoo ExportViaHeadlessDoc(
        FileJob job,
        string fileEnding,
        string subFolder,
        Dictionary<string, string> metadata,
        List<(GH_RuntimeMessageLevel Level, string Text)> messages)
    {
        RhinoDoc doc = null;

        try
        {
            doc = RhinoDoc.CreateHeadless(null);

            if (doc == null)
            {
                messages.Add((GH_RuntimeMessageLevel.Error, $"Failed to create Rhino document{job.Label}"));
                return null;
            }

            var layerCache = new Dictionary<string, int>();

            foreach (var item in job.Items)
            {
                if (!layerCache.TryGetValue(item.LayerName, out var layerIndex))
                {
                    layerIndex = doc.Layers.FindByFullPath(item.LayerName, RhinoMath.UnsetIntIndex);

                    if (layerIndex == RhinoMath.UnsetIntIndex)
                    {
                        layerIndex = doc.Layers.Add(new Layer
                        {
                            Name = item.LayerName,
                            Color = item.LayerColor
                        });

                        if (layerIndex < 0)
                        {
                            messages.Add((GH_RuntimeMessageLevel.Warning,
                                $"Failed to create layer '{item.LayerName}'{job.Label}"));
                            continue;
                        }
                    }

                    layerCache[item.LayerName] = layerIndex;
                }

                var objectId = doc.Objects.Add(item.Geometry, new ObjectAttributes
                {
                    LayerIndex = layerIndex,
                    Name = item.LayerName
                });

                if (objectId == Guid.Empty)
                {
                    messages.Add((GH_RuntimeMessageLevel.Warning,
                        $"Failed to add geometry to document{job.Label}"));
                }
            }

            var base64String = _converter.DocToBase64(doc, fileEnding);

            if (string.IsNullOrEmpty(base64String))
            {
                messages.Add((GH_RuntimeMessageLevel.Error, $"Failed to export file '{job.FileName}'{job.Label}"));
                return null;
            }

            return BuildFileData(job.FileName, base64String, fileEnding, subFolder, metadata);
        }
        catch (Exception ex)
        {
            messages.Add((GH_RuntimeMessageLevel.Error, $"Error during file export{job.Label}: {ex.Message}"));
            return null;
        }
        finally
        {
            doc?.Dispose();
        }
    }

    private static FileDataGoo BuildFileData(
        string fileName,
        string data,
        string fileType,
        string subFolder,
        Dictionary<string, string> metadata)
    {
        return new FileDataGoo(new FileData
        {
            FileName = fileName,
            Data = data,
            FileType = fileType,
            IsBase64Encoded = true,
            SubFolder = subFolder ?? "",
            Metadata = metadata ?? new Dictionary<string, string>()
        });
    }

    private static string GetLayerName(List<string> layerNames, int index)
    {
        if (layerNames == null || layerNames.Count == 0)
        {
            return DefaultLayerName;
        }

        if (index < layerNames.Count && !string.IsNullOrWhiteSpace(layerNames[index]))
        {
            return layerNames[index];
        }

        var lastName = layerNames.LastOrDefault(n => !string.IsNullOrWhiteSpace(n));
        return lastName ?? DefaultLayerName;
    }

    private static Color GetLayerColor(List<Color> layerColors, int index)
    {
        if (layerColors == null || layerColors.Count == 0)
        {
            return DefaultLayerColor;
        }

        if (index < layerColors.Count)
        {
            return layerColors[index];
        }

        return layerColors[layerColors.Count - 1];
    }
}
