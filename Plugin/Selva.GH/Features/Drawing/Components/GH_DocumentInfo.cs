using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Layout;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Defines the shared {token} values for a document — the reusable "header file" / project
// parameters. Wire the output into a Document's Info input; every header, footer, title block,
// and body text then resolves {project}, {client}, {rev}, … from this one source. Define it
// once and feed the same value into multiple Grasshopper files for unified output.
//
// Keys and Values are paired by index. A key with no matching value resolves to an empty
// string. Keys are case-insensitive ({Project} and {project} both match).
public class GH_DocumentInfo : GH_Component
{
    public GH_DocumentInfo()
        : base("Document Info", "DocInfo",
            "Shared {token} values resolved across a document's chrome and text. Wire into a Document's Info input.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.SectionSettings;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("7E4C1B92-2D6A-4F88-9C31-5A0E7B3F1C44");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Keys", "K", "Token names (without braces), e.g. \"project\", \"client\", \"rev\". Referenced as {project} in any field.", GH_ParamAccess.list);
        pManager.AddTextParameter("Values", "V", "Token values, paired with Keys by index.", GH_ParamAccess.list);

        pManager[0].Optional = true;
        pManager[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Info", "I", "Document Info — wire into a Document's Info input", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var keys = new List<string>();
        var values = new List<string>();
        DA.GetDataList(0, keys);
        DA.GetDataList(1, values);

        if (keys.Count != values.Count && keys.Count > 0 && values.Count > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"Keys ({keys.Count}) and Values ({values.Count}) differ in length — unmatched keys resolve to empty.");
        }

        DA.SetData(0, DocumentInfo.FromPairs(keys, values));
    }
}
