using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     "Options By": a table of options for one input, keyed by the value of another. Branch i of
///     Options holds the options offered when By is at its i-th value. The whole table goes to the
///     browser, which switches the list itself when By changes, so the form never waits for a solve.
///     The output wired into the Get Dynamic Value List it fills makes that input resolve its pick in
///     the same solve. By and the target are read from the wires, not from the data on them.
/// </summary>
public class GH_OptionsByComponent : GH_DynamicValueListOutput
{
    private const int OptionsIndex = 0;
    private const int ByIndex = 1;
    private const int KeysIndex = 2;

    public GH_OptionsByComponent()
        : base("Options By", "OptBy",
            "Options for one input that depend on the value of another. The browser switches the list " +
            "without a solve.")
    {
    }

    public override Guid ComponentGuid => new Guid("6C1E2B7A-4D3F-4E8B-9A15-2F7C0D6E8B31");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        // Tree access everywhere: one solve emits one payload, however many items the wires carry.
        pManager.AddTextParameter("Options", "O",
            "One branch per value of By. Each item is an option: a name, or \"name\" = value",
            GH_ParamAccess.tree);
        pManager.AddGenericParameter("By", "B",
            "Wire the input that decides the options: a Get Value List, a Get Boolean, or a Get Dynamic " +
            "Value List with Keys set", GH_ParamAccess.tree);
        pManager.AddTextParameter("Keys", "K",
            "Optional. The By value each branch belongs to, in branch order; * matches any other value. " +
            "Defaults to By's own items", GH_ParamAccess.tree);
        pManager[ByIndex].Optional = true;
        pManager[KeysIndex].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Options", "O",
            "Wire into the Get Dynamic Value List it fills, and into a Context Bake so the table reaches " +
            "the web UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess da)
    {
        da.GetDataTree(OptionsIndex, out GH_Structure<GH_String> optionTree);
        da.GetDataTree(ByIndex, out GH_Structure<IGH_Goo> byTree);
        da.GetDataTree(KeysIndex, out GH_Structure<GH_String> keyTree);

        var driver = WiredInputs.Find(Params.Input[ByIndex]).FirstOrDefault();
        var targets = WiredTargets();
        // Unwired, the target picked in the builder stands.
        TargetInputId = targets.FirstOrDefault()?.InstanceGuid ?? TargetInputId;

        if (driver == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Wire the input that decides the options into By.");
            return;
        }

        if (targets.Count == 0 && TargetInputId == Guid.Empty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "Wire the output into the Get Dynamic Value List these options fill.");
        }
        else if (targets.Count == 0)
        {
            SuggestWiringTarget(TargetInputId);
        }
        else if (targets.Count > 1)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Wire the output into one Get Dynamic Value List; only the first gets these options.");
        }

        var keys = WiredInputs.Strings(keyTree);
        if (keys.Count == 0)
        {
            keys = DriverKeys(driver);
            if (keys == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "By's values aren't known up front. List them in Keys, one per branch of Options.");
                return;
            }
        }

        var branches = optionTree?.Branches
            .Select(branch => (IReadOnlyList<string>)branch.Where(s => s != null).Select(s => s.Value).ToList())
            .ToList() ?? new List<IReadOnlyList<string>>();

        var problems = new List<string>();
        var table = OptionTableLogic.BuildTable(keys, branches, problems);
        foreach (var problem in problems)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, problem);
        }

        // One option set per item of By: a repeated By gives each row its own.
        var byKeys = byTree?.AllData(true).Select(KeyOf).ToList() ?? new List<string>();
        var itemOptions = (byKeys.Count == 0 ? new List<string> { null } : byKeys)
            .Select(key => OptionTableLogic.Pick(table, key))
            .ToList();

        var payload = new DynamicValueListPayload(TargetInputId, itemOptions[0])
        {
            By = driver.InstanceGuid.ToString(),
            Table = table,
            ItemOptions = itemOptions,
            ResolvedInSolve = targets.Count > 0
        };
        Message = $"{table.Count} branch(es)";
        da.SetData(0, new DynamicValueListGoo(payload));
    }

    // The values the browser sends for this input, in item order.
    private static List<string> DriverKeys(IGH_Param driver)
    {
        if (driver is GetValueListParameter valueList)
        {
            return valueList.ListItems.Select(item => item.Expression).ToList();
        }

        if (driver.TypeName.IndexOf("Boolean", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return new List<string> { "false", "true" };
        }

        return null;
    }

    // As the browser keys the table with JS String(): a Boolean as "true"/"false", a number in
    // invariant culture (a de-DE Rhino would otherwise key 2.5 as "2,5"), anything else as its text.
    private static string KeyOf(IGH_Goo goo)
    {
        if (goo == null)
        {
            return null;
        }

        return goo.ScriptVariable() switch
        {
            bool boolean => boolean ? "true" : "false",
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            { } value => value.ToString(),
            null => goo.ToString()
        };
    }
}
