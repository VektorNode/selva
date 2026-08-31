using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.Slva;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Obsolete Display From File component (until v0.18.0). SLVM v3 moved object identity into
///     the container's own table, so the Id input's restamp-on-load no longer applies — see
///     <see cref="GH_DisplayFromFile" />.
/// </summary>
public class OBSOLETE_DisplayFromFile_UntilV0_18_0 : GH_Component
{
    public OBSOLETE_DisplayFromFile_UntilV0_18_0()
        : base("Display From File", "DFF",
            "Reloads a Web Display payload from a Selva mesh file (.slvm, no re-meshing).",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.DisplayFromFile;
    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("8B2E5C71-9A34-4F6D-B017-3C4D5E6F7A81");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Path", "P", "Absolute path to the mesh file (.slvm)",
            GH_ParamAccess.item);
        pManager.AddTextParameter("Id", "Id",
            "Optional source component id to stamp on the payload (for stable web pick identity). " +
            "Leave empty to use this component's own id so each instance is distinct.",
            GH_ParamAccess.item, "");
        pManager[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Reloaded Web Display payload", "Selva", "Display", GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        string path = null;
        if (!DA.GetData(0, ref path) || string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        if (!File.Exists(path))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"File not found: {path}");
            return;
        }

        // The Id input drove a restamp against the pre-SLVM-v3 identity model (component-id
        // prefixed item ids, no in-container table). That model is gone; this frozen shape only
        // needs to exist long enough for GH_DisplayFromFileUpgrader_To_0_18 to remap it, so the
        // input is read and discarded rather than reproducing removed behavior.
        string idOverride = null;
        DA.GetData(1, ref idOverride);

        DisplayBatch batch;
        try
        {
            using (var fs = File.OpenRead(path))
            {
                batch = SlvmFile.Read(fs);
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to read mesh file: {ex.Message}");
            return;
        }

        DA.SetData(0, new WebDisplayGoo(batch));
    }
}
