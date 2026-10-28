using System;
using System.Collections;
using System.Collections.Generic;
using System.Windows.Forms;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.GUI;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Base for Selva's Get params, shaped like Rhino's own contextual params (Get Number, Get
///     String): one store for assigned values, the same saved settings and right-click menu, and
///     assigned values win over wired sources.
///
///     Values arrive as text (hex color, file JSON, option name) from the web UI and from
///     Rhino.Compute, which hands any contextual param it has no handler for a
///     <c>DataTree&lt;GH_String&gt;</c>. Keep <see cref="AssignContextualDataTree" /> on that
///     type: Compute only calls it when the signature matches.
/// </summary>
public abstract class SelvaContextualParameter<T> : GH_Param<T>, IGH_ContextualParameter2
    where T : class, IGH_Goo
{
    // Bounds one assign whatever AtMost says: a single request must not fan out into
    // hundreds of file imports.
    private const int MaxContextualItems = 100;

    private readonly string _defaultPrompt;
    private DataTree<object> _contextual;

    protected SelvaContextualParameter(string name, string nickname, string description, GH_ParamAccess access,
        string defaultPrompt = "")
        : base(name, nickname, description, "Params", "Util", access)
    {
        _defaultPrompt = defaultPrompt;
        Prompt = defaultPrompt;
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;

    public string Prompt { get; set; }
    public int AtLeast { get; set; } = 1;
    public int AtMost { get; set; } = 1;
    public bool TreeAccess { get; set; }
    public bool Immediate { get; set; } = true;

    public string ImpliedPrompt => string.IsNullOrWhiteSpace(Prompt) ? NickName : Prompt;

    public override void CreateAttributes()
    {
        m_attributes = new SelvaContextualParameterAttributes<T>(this);
    }

    public IEnumerable<object> ContextualData
    {
        get
        {
            if (_contextual == null)
            {
                yield break;
            }

            foreach (var item in _contextual.AllData())
            {
                yield return item;
            }
        }
    }

    public void AssignContextualData(IEnumerable data)
    {
        _contextual = null;
        if (data != null)
        {
            var tree = new DataTree<object>();
            var path = new GH_Path(0);
            foreach (var item in data)
            {
                if (item != null && !AddBounded(tree, item, path))
                {
                    break;
                }
            }

            _contextual = tree;
        }

        ExpireSolution(false);
    }

    public void AssignContextualDataTree(DataTree<GH_String> data)
    {
        _contextual = null;
        if (data != null)
        {
            var tree = new DataTree<object>();
            for (var i = 0; i < data.BranchCount && tree.DataCount < Limit; i++)
            {
                foreach (var item in data.Branches[i])
                {
                    if (item != null && !AddBounded(tree, item.Value, data.Paths[i]))
                    {
                        break;
                    }
                }
            }

            _contextual = tree;
        }

        ExpireSolution(false);
    }

    public virtual void ClearContextualData()
    {
        _contextual = null;
    }

    /// <summary>
    ///     Asks for a value inside Rhino, as Grasshopper Player does with Rhino's own Get params.
    ///     False means the user cancelled.
    /// </summary>
    public abstract bool AutoAssignContextualData(GH_ParameterContext context);

    /// <summary>
    ///     Turns one assigned value (a string, or a goo when assigned in-process) into output goo.
    ///     Runs at collect time, so it may read sources and post runtime messages.
    /// </summary>
    protected abstract IEnumerable<T> FromContextual(object value);

    /// <summary>The param's own behaviour when nothing is assigned and sources are wired.</summary>
    protected virtual void CollectFromSources()
    {
        base.CollectVolatileData_FromSources();
    }

    /// <summary>The param's own behaviour when nothing is assigned and nothing is wired.</summary>
    protected virtual void CollectWithoutSources()
    {
    }

    /// <summary>Runs before every collect, assigned values or not.</summary>
    protected virtual void BeforeCollect()
    {
    }

    protected override void CollectVolatileData_FromSources()
    {
        m_data.Clear();
        BeforeCollect();
        if (_contextual != null)
        {
            AppendContextual();
            return;
        }

        CollectFromSources();
    }

    protected override void CollectVolatileData_Custom()
    {
        m_data.Clear();
        BeforeCollect();
        if (_contextual != null)
        {
            AppendContextual();
            return;
        }

        CollectWithoutSources();
    }

    private int Limit => Math.Min(Math.Max(AtMost, 1), MaxContextualItems);

    private bool AddBounded(DataTree<object> tree, object item, GH_Path path)
    {
        if (tree.DataCount >= Limit)
        {
            return false;
        }

        tree.Add(item, path);
        return true;
    }

    private void AppendContextual()
    {
        for (var i = 0; i < _contextual.BranchCount; i++)
        {
            var path = _contextual.Paths[i];
            foreach (var value in _contextual.Branches[i])
            {
                foreach (var goo in FromContextual(value))
                {
                    if (goo != null)
                    {
                        m_data.Append(goo, path);
                    }
                }
            }
        }
    }

    // ============================================================================
    // Menu
    // ============================================================================

    public override void AppendAdditionalMenuItems(ToolStripDropDown menu)
    {
        base.AppendAdditionalMenuItems(menu);

        Menu_AppendSeparator(menu);
        Menu_AppendItem(menu, "Prompt…", (_, _) => EditPromptDialog());
        AppendCountItem(menu, "At least", "Lower limit on input items", AtLeast.ToString(), atLeast: true);
        AppendCountItem(menu, "At most", "Upper limit on input items",
            AtMost == int.MaxValue ? string.Empty : AtMost.ToString(), atLeast: false);

        var treeAccess = new ToolStripMenuItem("Tree Access")
        {
            ToolTipText = "Treat this input as a data tree on Rhino.Compute; overrides At most"
        };
        Menu_AppendItem(treeAccess.DropDown, "False", (_, _) => SetTreeAccess(false), true, !TreeAccess);
        Menu_AppendItem(treeAccess.DropDown, "True", (_, _) => SetTreeAccess(true), true, TreeAccess);
        menu.Items.Add(treeAccess);
    }

    public void EditPromptDialog()
    {
        if (Rhino.UI.Dialogs.ShowEditBox("Contextual prompt",
                "Specify the prompt message to be displayed while setting these values.", Prompt, false,
                out var text) && !string.Equals(Prompt, text))
        {
            RecordUndoEvent("Prompt");
            Prompt = text;
            OnPingDocument()?.Modified();
        }
    }

    private void AppendCountItem(ToolStripDropDown menu, string label, string tooltip, string current, bool atLeast)
    {
        var item = new ToolStripMenuItem(label) { ToolTipText = tooltip };
        Menu_AppendTextItem(item.DropDown, current, (sender, e) => OnCountKeyDown(sender, e, atLeast), null, true);
        menu.Items.Add(item);
    }

    private void OnCountKeyDown(GH_MenuTextBox sender, KeyEventArgs e, bool atLeast)
    {
        if (e.KeyCode == Keys.Escape)
        {
            sender.CloseEntireMenuStructure();
            return;
        }

        if (e.KeyCode != Keys.Enter)
        {
            return;
        }

        e.Handled = true;
        var text = sender.Text;
        // An empty At most means unbounded, as on Rhino's params.
        if (!atLeast && string.IsNullOrWhiteSpace(text))
        {
            text = int.MaxValue.ToString();
        }

        if (!int.TryParse(text, out var count) || count < 0)
        {
            return;
        }

        RecordUndoEvent(atLeast ? "Contextual AtLeast" : "Contextual AtMost");
        if (atLeast)
        {
            AtLeast = count;
        }
        else
        {
            AtMost = count;
        }

        OnPingDocument()?.Modified();
    }

    private void SetTreeAccess(bool treeAccess)
    {
        RecordUndoEvent("Set Tree Access");
        TreeAccess = treeAccess;
        OnPingDocument()?.Modified();
    }

    // ============================================================================
    // Persistence
    // ============================================================================

    public override bool Write(GH_IWriter writer)
    {
        writer.SetString("Prompt", Prompt ?? string.Empty);
        writer.SetInt32("AtLeast", AtLeast);
        writer.SetInt32("AtMost", AtMost);
        writer.SetBoolean("TreeAccess", TreeAccess);
        writer.SetBoolean("Immediate", Immediate);
        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        Prompt = reader.ItemExists("Prompt") ? reader.GetString("Prompt") ?? _defaultPrompt : _defaultPrompt;

        var atLeast = 1;
        if (reader.TryGetInt32("AtLeast", ref atLeast))
        {
            AtLeast = atLeast;
        }

        var atMost = 1;
        if (reader.TryGetInt32("AtMost", ref atMost))
        {
            AtMost = atMost;
        }

        var treeAccess = false;
        if (reader.TryGetBoolean("TreeAccess", ref treeAccess))
        {
            TreeAccess = treeAccess;
        }

        var immediate = true;
        if (reader.TryGetBoolean("Immediate", ref immediate))
        {
            Immediate = immediate;
        }

        return base.Read(reader);
    }
}
