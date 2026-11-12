using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.ComputeIO.Goos;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     "Options Table": a table of valid combinations fills Get Dynamic Value Lists. The output goes
///     into one, that one into the next, and so on: each offers the values its column still has in the
///     rows the picks before it left, and resolves its own pick in the same solve. One input may feed
///     several, which then narrow independently of each other. An input wired into By narrows the
///     rows too, without being filled: a Get Value List or a Get Boolean, whose options are its own.
///     The browser gets the columns in use and narrows them itself, so no pick waits for a solve to
///     update the lists that depend on it.
///     <para>
///         It only shapes the form. The inputs output plain text and the table stays an ordinary
///         Panel, so a definition still solves with this component deleted and the inputs swapped
///         for Value Lists.
///     </para>
/// </summary>
public class GH_OptionsTableComponent : GH_DynamicValueListOutput
{
    private const int TableIndex = 0;
    private const int ByIndex = 1;

    // The wiring the last solve built its payload for.
    private string _builtFor;

    public GH_OptionsTableComponent()
        : base("Options Table", "OptTable",
            "Options for inputs that depend on each other, from a table of valid combinations. Each input " +
            "offers what the picks before it leave.")
    {
    }

    public override Guid ComponentGuid => new Guid("116A5E1C-7275-43C6-AAB4-AD4680C56D7E");
    protected override Bitmap Icon => Resources.OptionsTable;
    public override bool TargetFromWiring => true;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Table", "T",
            "One valid combination per line, cells separated by commas, semicolons or tabs. The first " +
            "line names the columns. A Panel pasted from a spreadsheet works as is",
            GH_ParamAccess.tree);
        pManager.AddGenericParameter("By", "B",
            "Optional. Inputs that narrow the table without being filled from it: a Get Value List, a Get " +
            "Boolean. Each reads the column named like it", GH_ParamAccess.tree);
        pManager[ByIndex].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Options", "O",
            "Wire into the Get Dynamic Value List for the first column, that one into the next, and so " +
            "on. Also into a Context Bake so the table reaches the web UI", GH_ParamAccess.item);
    }

    // Wiring an input in or out, or renaming one, changes the payload but expires nothing upstream
    // of it, and this component is upstream. Without this the payload would keep describing the old
    // wiring: the browser narrowing an input Grasshopper no longer does, or the other way round.
    public override void AddedToDocument(GH_Document document)
    {
        base.AddedToDocument(document);
        document.SolutionStart -= OnSolutionStart;
        document.SolutionStart += OnSolutionStart;
    }

    public override void RemovedFromDocument(GH_Document document)
    {
        document.SolutionStart -= OnSolutionStart;
        base.RemovedFromDocument(document);
    }

    private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
    {
        if (_builtFor != null && Phase != GH_SolutionPhase.Blank && WiringKey(Drivers(), Filled()) != _builtFor)
        {
            ExpireSolution(false);
        }
    }

    private static string WiringKey(IEnumerable<IGH_Param> drivers, IEnumerable<(GetDynamicValueListParameter Input, int Parent)> filled)
    {
        return string.Join("|", drivers.Select(driver => driver.InstanceGuid + " " + driver.NickName)) + "||" +
               string.Join("|", filled.Select(f => f.Input.InstanceGuid + " " + f.Input.NickName + " " + f.Parent));
    }

    protected override void SolveInstance(IGH_DataAccess da)
    {
        da.GetDataTree(TableIndex, out GH_Structure<GH_String> text);

        var problems = new List<string>();
        var table = PickTableLogic.Parse(WiredInputs.Strings(text), problems);

        var drivers = Drivers();
        var filled = Filled();
        _builtFor = WiringKey(drivers, filled);
        if (filled.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "Wire the output into the Get Dynamic Value List for the first column.");
        }

        // By inputs take their columns first, so one named like a column gets it even when an input
        // without a matching name would otherwise have taken it as the leftmost free one.
        var columns = PickTableLogic.AssignColumns(table.Columns,
            drivers.Select(driver => driver.NickName).Concat(filled.Select(f => f.Input.NickName)).ToList());

        var by = new List<(IGH_Param Driver, int Column)>();
        for (var d = 0; d < drivers.Count; d++)
        {
            if (columns[d] >= 0)
            {
                by.Add((drivers[d], columns[d]));
            }
            else
            {
                problems.Add($"No column left for \"{drivers[d].NickName}\" in By. It narrows nothing.");
            }
        }

        // An input without a column gets no options, and neither do the inputs wired from it.
        var kept = new List<(GetDynamicValueListParameter Input, int Parent, int Column)>();
        var keptIndex = new Dictionary<int, int>();
        for (var i = 0; i < filled.Count; i++)
        {
            var column = columns[drivers.Count + i];
            var parent = filled[i].Parent;
            if (column < 0 || (parent >= 0 && !keptIndex.ContainsKey(parent)))
            {
                problems.Add(column < 0
                    ? $"No column left for \"{filled[i].Input.NickName}\". It gets no options."
                    : $"\"{filled[i].Input.NickName}\" gets no options: the input it is wired from has none.");
                continue;
            }

            keptIndex[i] = kept.Count;
            kept.Add((filled[i].Input, parent >= 0 ? keptIndex[parent] : -1, column));
        }

        foreach (var problem in problems)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, problem);
        }

        // With no input to fill, projecting would leave combinations nobody reads.
        var rows = kept.Count == 0
            ? new List<List<string>>()
            : PickTableLogic.Project(table, by.Select(b => b.Column).Concat(kept.Select(k => k.Column)).ToList());
        var byValues = by.Select(b => (IReadOnlyList<string>)b.Driver.VolatileData.AllData(true).Select(KeyOf)
            .Where(key => key != null).ToList()).ToList();

        TargetInputId = Guid.Empty;
        Message = $"{rows.Count} combination(s)";
        da.SetData(0, new DynamicValueListGoo(new DynamicValueListPayload
        {
            ResolvedInSolve = true,
            PickTable = new PickTable
            {
                By = by.Select(b => b.Driver.InstanceGuid.ToString()).ToList(),
                Inputs = kept.Select(k => k.Input.InstanceGuid.ToString()).ToList(),
                Parents = kept.Select(k => k.Parent).ToList(),
                Rows = rows,
                Start = PickTableLogic.StartSets(rows, byValues)
            }
        }));
    }

    /// <summary>The Selva inputs wired into By, in wire order.</summary>
    private List<IGH_Param> Drivers()
    {
        return WiredInputs.Find(Params.Input[ByIndex]);
    }

    /// <summary>
    ///     The inputs this table fills, a parent before its children: the ones the output feeds, then
    ///     the ones each of those feeds, and so on. Parent is an index into the list, -1 for the first.
    /// </summary>
    private List<(GetDynamicValueListParameter Input, int Parent)> Filled()
    {
        var filled = new List<(GetDynamicValueListParameter Input, int Parent)>();
        var seen = new HashSet<Guid>();
        var pending = new Queue<(GetDynamicValueListParameter Input, int Parent)>(
            WiredTargets().Select(input => (input, -1)));
        while (pending.Count > 0)
        {
            var next = pending.Dequeue();
            if (!seen.Add(next.Input.InstanceGuid))
            {
                continue;
            }

            var index = filled.Count;
            filled.Add(next);
            foreach (var child in WiredInputs.Fed(next.Input).OfType<GetDynamicValueListParameter>())
            {
                pending.Enqueue((child, index));
            }
        }

        return filled;
    }

    // As the browser turns a By input's value into text with JS String(): a Boolean as "true" or
    // "false", a number in invariant culture (a de-DE Rhino would otherwise write 2.5 as "2,5"),
    // anything else as its text.
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
