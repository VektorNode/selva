using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.FileIO.Components;

/// <summary>
///     Standalone canvas parameter that holds FileDataGoo values.
///     Implements ISelvaFileOutput so the schema scanner detects it as a file output
///     without needing a ContextBakeComponent in between.
///     Usage: wire from GH_DataToFile / GH_BlockToFile (or any ISelvaFileOutput component),
///     or from external sources. The Selva UI picks this up as a downloadable file output.
/// </summary>
public class Param_FileData : GH_PersistentParam<FileDataGoo>, ISelvaFileOutput
{
    public Param_FileData()
        : base(
            "File Data",
            "FileData",
            "Holds file data for download via the Selva UI",
            "Selva",
            "IO")
    {
    }

    public override Guid ComponentGuid => new Guid("ACBCC8DD-9B2E-4A5D-8BE3-25FBE2B1CABA");

    public override GH_Exposure Exposure => GH_Exposure.secondary;

    protected override Bitmap Icon => Resources.CreateFile;

    protected override GH_GetterResult Prompt_Singular(ref FileDataGoo value)
    {
        // No interactive picker for file data — values come from wired sources only
        return GH_GetterResult.cancel;
    }

    protected override GH_GetterResult Prompt_Plural(ref List<FileDataGoo> values)
    {
        return GH_GetterResult.cancel;
    }
}
