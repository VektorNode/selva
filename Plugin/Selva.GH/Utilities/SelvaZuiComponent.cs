using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

namespace Selva.GH.Utilities;

/// <summary>
///     A component that hides its rarely used inputs until asked for, like Rhino 8's Model
///     components: zoom in for the show/hide buttons, or right-click for Show all / Hide unused.
///
///     RegisterInputParams registers the full list; inputs left out of <see cref="PrimaryInputs" />
///     leave again on placement. The visible list varies, so SolveInstance reads inputs by name
///     through <see cref="GetInput{T}" /> and its siblings, never by index. A hidden input reads as
///     its registered default.
///
///     Turning a released component into one of these still needs a new ComponentGuid: an older
///     plugin reads the saved, shorter list by index.
/// </summary>
public abstract class SelvaZuiComponent : GH_Component, IGH_VariableParameterComponent
{
    // Per component type, the full input list as registered: the order hidden inputs return in,
    // the defaults they read as, and which may hide. Never placed on a canvas, so never edited.
    private static readonly ConcurrentDictionary<Type, IGH_Param[]> TemplateCache = new();

    private IGH_Param[] _registered;

    protected SelvaZuiComponent(string name, string nickname, string description, string category,
        string subCategory)
        : base(name, nickname, description, category, subCategory)
    {
    }

    /// <summary>Names of the inputs shown on placement. Required inputs show regardless.</summary>
    protected abstract IReadOnlyCollection<string> PrimaryInputs { get; }

    private IGH_Param[] Templates =>
        TemplateCache.GetOrAdd(GetType(), type => ((SelvaZuiComponent)Activator.CreateInstance(type))._registered);

    internal bool HasHiddenInputs => Templates.Any(t => Params.IndexOfInputParam(t.Name) < 0);

    internal bool HasUnusedInputs => Params.Input.Any(p => CanHide(p) && IsUnused(p));

    protected override void PostConstructor()
    {
        base.PostConstructor();
        _registered = Params.Input.ToArray();
        var primary = PrimaryInputs;
        foreach (var param in _registered)
        {
            if (!IsRequired(param) && !primary.Contains(param.Name))
            {
                Params.UnregisterInputParameter(param);
            }
        }

        Params.OnParametersChanged();
    }

    public override void CreateAttributes()
    {
        m_attributes = new SelvaZuiAttributes(this);
    }

    // ============================================================================
    // Reading inputs by name
    // ============================================================================

    protected bool GetInput<T>(IGH_DataAccess DA, string name, ref T value)
    {
        var index = Params.IndexOfInputParam(name);
        if (index >= 0)
        {
            return DA.GetData(index, ref value);
        }

        foreach (var goo in DefaultsOf(name))
        {
            return TryCast(goo, ref value);
        }

        return false;
    }

    protected bool GetInputList<T>(IGH_DataAccess DA, string name, List<T> list)
    {
        var index = Params.IndexOfInputParam(name);
        if (index >= 0)
        {
            return DA.GetDataList(index, list);
        }

        var found = false;
        foreach (var goo in DefaultsOf(name))
        {
            var value = default(T);
            if (TryCast(goo, ref value))
            {
                list.Add(value);
                found = true;
            }
        }

        return found;
    }

    // Tree inputs carry no defaults, so a hidden one reads as unwired.
    protected bool GetInputTree<T>(IGH_DataAccess DA, string name, out GH_Structure<T> tree) where T : IGH_Goo
    {
        var index = Params.IndexOfInputParam(name);
        if (index >= 0)
        {
            return DA.GetDataTree(index, out tree);
        }

        _ = TemplateOf(name); // throws on a misspelt name, as the other getters do
        tree = null;
        return false;
    }

    private IEnumerable<IGH_Goo> DefaultsOf(string name)
    {
        return PersistentDataOf(TemplateOf(name))?.AllData(true) ?? Enumerable.Empty<IGH_Goo>();
    }

    private static bool TryCast<T>(IGH_Goo goo, ref T value)
    {
        if (goo is T direct)
        {
            value = direct;
            return true;
        }

        return goo.CastTo(out value);
    }

    // ============================================================================
    // Showing and hiding
    // ============================================================================

    /// <summary>Shows every hidden input, each at its registered default.</summary>
    public void ShowAllInputs()
    {
        var templates = Templates;
        SelvaZuiComponent donor = null;
        for (var i = 0; i < templates.Length; i++)
        {
            if (Params.IndexOfInputParam(templates[i].Name) >= 0)
            {
                continue;
            }

            donor ??= (SelvaZuiComponent)Activator.CreateInstance(GetType());
            var at = Params.Input.Count(p => TemplateIndex(p.Name) < i);
            Params.RegisterInputParam(donor.TakeInput(templates[i].Name), at);
        }
    }

    /// <summary>Hides every input that is neither wired nor changed from its default.</summary>
    public void HideUnusedInputs()
    {
        for (var i = Params.Input.Count - 1; i >= 0; i--)
        {
            var param = Params.Input[i];
            if (CanHide(param) && IsUnused(param))
            {
                Params.UnregisterInputParameter(param);
            }
        }
    }

    internal void ShowAllInputsAction()
    {
        ChangeInputs("Show all parameters", ShowAllInputs);
    }

    internal void HideUnusedInputsAction()
    {
        ChangeInputs("Hide unused parameters", HideUnusedInputs);
    }

    private void ChangeInputs(string undoName, Action change)
    {
        if (OnPingDocument() == null)
        {
            return;
        }

        RecordUndoEvent(undoName);
        change();
        Params.OnParametersChanged();
        ExpireSolution(true);
    }

    protected override void AppendAdditionalComponentMenuItems(ToolStripDropDown menu)
    {
        base.AppendAdditionalComponentMenuItems(menu);
        Menu_AppendSeparator(menu);
        Menu_AppendItem(menu, "Hide unused parameters", (_, _) => HideUnusedInputsAction(), HasUnusedInputs);
        Menu_AppendItem(menu, "Show all parameters", (_, _) => ShowAllInputsAction(), HasHiddenInputs);
    }

    // A hidden input reads as its default, so only an input that needs a value of its own stays.
    private static bool IsRequired(IGH_Param template)
    {
        return !template.Optional && (PersistentDataOf(template)?.DataCount ?? 0) == 0;
    }

    private bool CanHide(IGH_Param param)
    {
        var index = TemplateIndex(param.Name);
        return index < 0 || !IsRequired(Templates[index]);
    }

    private bool IsUnused(IGH_Param param)
    {
        if (param.SourceCount > 0)
        {
            return false;
        }

        var index = TemplateIndex(param.Name);
        return index < 0 || DefaultsOf(param.Name).Select(Describe)
            .SequenceEqual(PersistentDataOf(param)?.AllData(true).Select(Describe) ?? Enumerable.Empty<string>());
    }

    private static string Describe(IGH_Goo goo)
    {
        return goo?.ToString();
    }

    private IGH_Param TakeInput(string name)
    {
        var param = _registered.First(p => p.Name == name);
        Params.UnregisterInputParameter(param);
        return param;
    }

    private int TemplateIndex(string name)
    {
        return Array.FindIndex(Templates, t => t.Name == name);
    }

    private IGH_Param TemplateOf(string name)
    {
        var index = TemplateIndex(name);
        if (index < 0)
        {
            throw new ArgumentException($"{GetType().Name} registers no input named '{name}'.", nameof(name));
        }

        return Templates[index];
    }

    // GH_PersistentParam<T> has no non-generic view of its data.
    private static IGH_Structure PersistentDataOf(IGH_Param param)
    {
        return param.GetType()
            .GetProperty("PersistentData", BindingFlags.Public | BindingFlags.Instance)
            ?.GetValue(param) as IGH_Structure;
    }

    // ============================================================================
    // IGH_VariableParameterComponent
    // ============================================================================

    public bool CanInsertParameter(GH_ParameterSide side, int index)
    {
        return side == GH_ParameterSide.Input && HiddenTemplateAt(index) != null;
    }

    public bool CanRemoveParameter(GH_ParameterSide side, int index)
    {
        return side == GH_ParameterSide.Input && CanHide(Params.Input[index]);
    }

    public IGH_Param CreateParameter(GH_ParameterSide side, int index)
    {
        var template = HiddenTemplateAt(index);
        return template == null
            ? null
            : ((SelvaZuiComponent)Activator.CreateInstance(GetType())).TakeInput(template.Name);
    }

    public bool DestroyParameter(GH_ParameterSide side, int index)
    {
        return CanRemoveParameter(side, index);
    }

    public void VariableParameterMaintenance()
    {
    }

    // The first hidden input that belongs between the visible inputs at index - 1 and index.
    private IGH_Param HiddenTemplateAt(int index)
    {
        var templates = Templates;
        var inputs = Params.Input;
        var from = index > 0 ? TemplateIndex(inputs[index - 1].Name) + 1 : 0;
        var to = index < inputs.Count ? TemplateIndex(inputs[index].Name) : templates.Length;
        for (var i = from; i < to; i++)
        {
            if (Params.IndexOfInputParam(templates[i].Name) < 0)
            {
                return templates[i];
            }
        }

        return null;
    }
}
