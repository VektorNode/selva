using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Selva.FileIO;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.Schema.Models;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that imports geometry from files (local path, URL, or base64).
///     Supported formats are defined in AcceptedFileFormats.Values (schema-driven).
/// </summary>
public class GetFileParameter : SelvaContextualParameter<IGH_GeometricGoo>
{
    public GetFileParameter()
        : base("Get File", "Get File", "Import geometry from file (path, URL, or upload)", GH_ParamAccess.list,
            "Select a file to import")
    {
    }

    public override string TypeName => "File";
    public override Guid ComponentGuid => new Guid("B4F6E8D2-9A3C-4E7B-8D1F-5A9C7E2B4D6F");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.CreateFile);

    public override bool AutoAssignContextualData(GH_ParameterContext context)
    {
        var paths = Utils.PickFiles(ImpliedPrompt, AcceptedFileFormats.Values, AtMost > 1);
        if (paths == null || paths.Count == 0)
        {
            return false;
        }

        AssignContextualData(paths.Select(FileInputData.FromPath).ToList());
        return true;
    }

    protected override IEnumerable<IGH_GeometricGoo> FromContextual(object value)
    {
        var fileData = FileInputParser.Parse(value);
        var problem = FileInputParser.Validate(fileData, AcceptedFileFormats.Values);
        if (problem != null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, problem);
            return Enumerable.Empty<IGH_GeometricGoo>();
        }

        return FileImporter.ImportAsGoo(fileData, AddRuntimeMessage);
    }

    // A wired path, URL or file JSON imports like an assigned one; each item keeps its branch. Only
    // File Path and Text sources count: any other goo stringifies into a bogus path.
    protected override void CollectFromSources()
    {
        foreach (var source in Sources)
        {
            var data = source is Param_FilePath or Param_String ? source.VolatileData : null;
            if (data == null || data.IsEmpty)
            {
                continue;
            }

            foreach (var path in data.Paths)
            {
                foreach (var item in data.get_Branch(path))
                {
                    var fileData = FileInputParser.Parse(item);
                    if (fileData != null)
                    {
                        m_data.AppendRange(FileImporter.ImportAsGoo(fileData, AddRuntimeMessage), path);
                    }
                }
            }
        }
    }
}
