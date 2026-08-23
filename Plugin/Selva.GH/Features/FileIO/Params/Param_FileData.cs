using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Properties;

namespace Selva.GH.Features.FileIO.Params;

/// <summary>
///     Standalone canvas parameter holding FileDataGoo values. Implements ISelvaFileOutput
///     so the schema scanner detects it as a file output without a ContextBake in between.
///     Wire it from GH_DataToFileGeneric / GH_BlockToFile or any other ISelvaFileOutput source.
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
        return GH_GetterResult.cancel;
    }

    protected override GH_GetterResult Prompt_Plural(ref List<FileDataGoo> values)
    {
        return GH_GetterResult.cancel;
    }
}
