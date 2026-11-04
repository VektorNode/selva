using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Selva.FileIO;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     A contextual parameter that supplies an image (PNG/JPEG/WEBP/SVG) from the web UI as a
///     FileInputGoo (path, URL, or base64). Unlike Get File this does no Rhino import — it
///     carries the raw image payload downstream, where Draw Image turns it into an ImageElement.
/// </summary>
public class GetImageParameter : SelvaContextualParameter<FileInputGoo>
{
    public GetImageParameter()
        : base("Get Image", "Get Image", "Supply an image from the web UI (path, URL, or upload)",
            GH_ParamAccess.item, "Select an image")
    {
    }

    public override string TypeName => "Image";
    public override Guid ComponentGuid => new Guid("D7A2F4C8-3B6E-4A91-8C5D-2E9F7B1A6D04");

    protected override Bitmap Internal_Icon_24x24 => Utils.ContextualiseIcon(Resources.CreateFile);

    public override bool AutoAssignContextualData(GH_ParameterContext context)
    {
        var paths = Utils.PickFiles(ImpliedPrompt, ImageInputResolver.AcceptedFormats, AtMost > 1);
        if (paths == null || paths.Count == 0)
        {
            return false;
        }

        AssignContextualData(paths.Select(FileInputData.FromPath).ToList());
        return true;
    }

    protected override IEnumerable<FileInputGoo> FromContextual(object value)
    {
        var fileData = FileInputParser.Parse(value);
        var problem = FileInputParser.Validate(fileData, ImageInputResolver.AcceptedFormats);
        if (problem != null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, problem);
            yield break;
        }

        yield return new FileInputGoo(fileData);
    }

    protected override void CollectFromSources()
    {
        foreach (var source in Sources)
        {
            var data = source?.VolatileData;
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
                        m_data.Append(new FileInputGoo(fileData), path);
                    }
                }
            }
        }
    }
}
