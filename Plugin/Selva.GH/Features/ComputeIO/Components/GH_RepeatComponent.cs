using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     "Repeat": shows the Get Dynamic Value Lists its output is wired into once per row. Rows come
///     from Keys (with optional Labels and Section), so their number can depend on the definition. Each
///     repeated input outputs one item per row, in row order, and finds its pick by row key in the same
///     solve, so a pick stays with its row when rows come and go.
/// </summary>
public class GH_RepeatComponent : GH_DynamicValueListOutput
{
    private const int KeysIndex = 0;
    private const int LabelsIndex = 1;
    private const int SectionIndex = 2;

    public GH_RepeatComponent()
        : base("Repeat", "Repeat",
            "Show the Get Dynamic Value Lists wired from this output once per row in the web UI. Each then " +
            "outputs one item per row.")
    {
    }

    public override Guid ComponentGuid => new Guid("3B8F5D21-7C6A-4E19-A2D4-8E0B1C9F6A57");
    public override bool TargetFromWiring => true;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Keys", "K",
            "One key per row. Picks follow their key when rows come and go", GH_ParamAccess.tree);
        pManager.AddTextParameter("Labels", "L", "Optional. The name shown on each row", GH_ParamAccess.tree);
        pManager.AddTextParameter("Section", "S",
            "Optional. Rows with the same section are listed under one heading", GH_ParamAccess.tree);
        pManager[LabelsIndex].Optional = true;
        pManager[SectionIndex].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Rows", "R",
            "Wire into each Get Dynamic Value List to show once per row, and into a Context Bake so the " +
            "rows reach the web UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess da)
    {
        da.GetDataTree(KeysIndex, out GH_Structure<GH_String> keys);
        da.GetDataTree(LabelsIndex, out GH_Structure<GH_String> labels);
        da.GetDataTree(SectionIndex, out GH_Structure<GH_String> sections);

        var problems = new List<string>();
        var rows = OptionTableLogic.BuildRows(WiredInputs.Strings(keys), WiredInputs.Strings(labels),
            WiredInputs.Strings(sections), problems);
        foreach (var problem in problems)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, problem);
        }

        var members = WiredTargets().Select(member => member.InstanceGuid.ToString()).ToList();
        if (members.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "Wire the output into each Get Dynamic Value List to show once per row.");
        }

        TargetInputId = Guid.Empty;
        Message = $"{rows.Count} row(s)";
        da.SetData(0, new DynamicValueListGoo(new DynamicValueListPayload
        {
            Rows = rows, Members = members, ResolvedInSolve = true
        }));
    }
}
