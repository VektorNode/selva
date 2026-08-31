using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Newtonsoft.Json;
using Rhino;
using Rhino.UI;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.UIBuilder.Components;

/// <summary>
///     Registers existing canvas controls (Number Sliders, Value Lists, Boolean Toggles, Panels) by
///     GUID, previews the contextual parameter each one infers, and inserts those parameters
///     between a control and the inputs it drives - or beside a disconnected control - so an
///     external publisher can drive them. Removes only the nodes it created or explicitly adopted.
///
///     Every mutation is an explicit button press. Nothing here runs during an ordinary solve, a
///     study run, a file open, or a schema export.
/// </summary>
public sealed class GH_PrepareUIInputs : GH_Component
{
    private const string LinkedControlsKey = "prepare_ui_inputs_controls";
    private const string ManagedLinksKey = "prepare_ui_inputs_links";

    private readonly List<Guid> _linkedControlIds = new();
    private readonly List<PrepareUIInputManagedLink> _managedLinks = new();
    private PrepareUIInputsDialog _previewWindow;
    private string _status = "Select controls on the canvas, then click Link selected controls.";

    public GH_PrepareUIInputs()
        : base(
            "Prepare UI Inputs",
            "Prepare Inputs",
            "Registers Number Sliders, Value Lists, Boolean Toggles, and Panels, then inserts the " +
                "matching Get parameter so a client-facing web interface can drive them remotely." +
                "\n\nTo use this component, select one or more controls on the canvas (sliders, lists, toggles, panels) and click the 'Link selected controls' button." +
                "\n\nComponent contributed by: Juan Diego Vargas",
            "Selva",
            "UI")
    {
    }

    public override Guid ComponentGuid => new Guid("E65EBEE0-36E8-4E87-9239-479D632BFCDE");

    public override GH_Exposure Exposure => GH_Exposure.primary;

    protected override Bitmap Icon => Resources.PrepareUIInputs;

    public override void CreateAttributes()
    {
        m_attributes = new PrepareUIInputsAttributes(this);
    }

    public override void RemovedFromDocument(GH_Document document)
    {
        ClosePreviewWindow();
        base.RemovedFromDocument(document);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        // No input parameters unless a functional need is established during implementation.
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter(
            "Controls",
            "C",
            "One status line per registered control: source control, control kind, contextual " +
                "parameter (marked when the author overrode the inferred one), item/list access, " +
                "recipient count, and current status.",
            GH_ParamAccess.list);
        pManager.AddTextParameter(
            "Report",
            "R",
            "Result of the most recent preparation or removal, plus the counts of created, " +
                "reused, repaired, removed, skipped, and failed items.",
            GH_ParamAccess.item);
    }

    /// <summary>
    ///     Read-only. Solving reports the current state of the registered controls and never edits
    ///     the document; preparation must be an intentional, manual act.
    /// </summary>
    protected override void SolveInstance(IGH_DataAccess dataAccess)
    {
        List<PrepareUIInputCandidate> candidates = BuildPreparationCandidates();
        var lines = new List<string>();
        foreach (PrepareUIInputCandidate candidate in candidates)
        {
            PrepareUIInputManagedLink link = _managedLinks.FirstOrDefault(managed => managed.ControlId == candidate.ControlId);
            string key = link?.Key ?? PrepareUIInputInference.BuildKey(candidate.ControlNickName, candidate.ControlId);
            string overrideSuffix = candidate.TypeOverridden ? " (overridden)" : string.Empty;
            lines.Add($"{key} | {PrepareUIInputInference.Describe(candidate.Kind)} | {candidate.TypeName}" +
                $"{overrideSuffix} | {candidate.AccessName.ToLowerInvariant()} | " +
                $"{candidate.RecipientCount} recipient(s) | {candidate.StatusText}");
        }

        int ambiguous = candidates.Count(candidate => candidate.Status == PrepareUIInputStatus.Ambiguous);
        int missing = candidates.Count(candidate => candidate.Status == PrepareUIInputStatus.MissingDependency);
        if (ambiguous > 0)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Remark,
                $"{ambiguous} registered control(s) have wiring this component will not rewrite " +
                    "automatically. Open the preview to see why.");
        }

        if (missing > 0)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Warning,
                $"{missing} registered control(s) need a contextual parameter type that is not " +
                    "installed. Nothing is substituted for it.");
        }

        dataAccess.SetDataList(0, lines);
        dataAccess.SetData(1, _status);
        Message = _linkedControlIds.Count == 0
            ? string.Empty
            : $"{_managedLinks.Count}/{_linkedControlIds.Count} prepared";
    }

    // ------------------------------------------------------------------
    //  Canvas actions
    // ------------------------------------------------------------------

    /// <summary>
    ///     Registers every supported control currently selected on the canvas, plus the supported
    ///     source controls of any selected contextual parameters. Connected recognized Get nodes are
    ///     selected as immediate visual feedback and are adopted later by Prepare inputs.
    ///     Registration is bookkeeping only: no wire is touched here.
    /// </summary>
    internal void LinkSelectedControls()
    {
        GH_Document document = ActiveDocument();
        if (document == null)
        {
            SetStatus("No active Grasshopper document was found.");
            return;
        }

        List<IGH_Param> selectedParameters = document.Objects
            .OfType<IGH_Param>()
            .Where(parameter => parameter.Attributes?.Selected == true)
            .ToList();

        List<IGH_Param> selected = selectedParameters
            .Where(parameter => PrepareUIInputTypeResolver.Classify(parameter) != PrepareUIInputControlKind.Unknown)
            .Concat(selectedParameters
                .Where(parameter => parameter is IGH_ContextualParameter)
                .SelectMany(parameter => parameter.Sources ?? Array.Empty<IGH_Param>())
                .Where(source => PrepareUIInputTypeResolver.Classify(source) != PrepareUIInputControlKind.Unknown))
            .GroupBy(parameter => parameter.InstanceGuid)
            .Select(group => group.First())
            .OrderBy(parameter => parameter.Attributes.Bounds.Y)
            .ThenBy(parameter => parameter.Attributes.Bounds.X)
            .ToList();

        int added = 0;
        var detectedGetIds = new HashSet<Guid>();
        foreach (IGH_Param control in selected)
        {
            if (!_linkedControlIds.Contains(control.InstanceGuid))
            {
                _linkedControlIds.Add(control.InstanceGuid);
                added++;
            }

            IEnumerable<IGH_Param> connectedContextualParameters = (control.Recipients ?? Array.Empty<IGH_Param>())
                .Where(recipient => recipient is IGH_ContextualParameter)
                .Where(recipient => PrepareUIInputInference.FromGuid(recipient.ComponentGuid) != null);
            foreach (IGH_Param contextual in connectedContextualParameters)
            {
                detectedGetIds.Add(contextual.InstanceGuid);
                if (contextual.Attributes != null)
                {
                    contextual.Attributes.Selected = true;
                }
            }
        }

        if (selected.Count == 0)
        {
            SetStatus("Select one or more Number Sliders, Value Lists, Boolean Toggles, or Panels, " +
                "then click Link selected controls.");
            return;
        }

        string detectedSuffix = detectedGetIds.Count > 0
            ? $" Detected and selected {detectedGetIds.Count} connected Get input(s)."
            : string.Empty;
        SetStatus($"Registered {added} new control(s); {_linkedControlIds.Count} total.{detectedSuffix}");
    }

    /// <summary>
    ///     Unregisters the selected controls. This does not touch any contextual parameter already
    ///     on the canvas, so a still-managed node is reported rather than silently orphaned.
    /// </summary>
    internal void UnlinkSelectedControls()
    {
        GH_Document document = ActiveDocument();
        if (document == null)
        {
            SetStatus("No active Grasshopper document was found.");
            return;
        }

        var selectedIds = new HashSet<Guid>(document.Objects
            .Where(documentObject => documentObject.Attributes?.Selected == true)
            .Select(documentObject => documentObject.InstanceGuid));
        int stillManaged = _managedLinks.Count(link => selectedIds.Contains(link.ControlId));
        int removed = _linkedControlIds.RemoveAll(selectedIds.Contains);
        _managedLinks.RemoveAll(link => selectedIds.Contains(link.ControlId));

        if (removed == 0)
        {
            SetStatus("None of the selected objects were registered.");
            return;
        }

        string managedSuffix = stillManaged > 0
            ? $" {stillManaged} inserted contextual parameter(s) were left on the canvas; delete " +
                "them by hand or re-register the control first."
            : string.Empty;
        SetStatus($"Unregistered {removed} control(s).{managedSuffix}");
    }

    internal void ClearRegistrations()
    {
        _linkedControlIds.Clear();
        _managedLinks.Clear();
        SetStatus("All registrations cleared. Nothing on the canvas was changed.");
    }

    /// <summary>
    ///     Preview every registered control - ready to prepare or already prepared - in one list,
    ///     then apply insertions/repairs or removals from it. The same candidates and selection
    ///     serve both actions: ApplyPreparation and ApplyRemoval each only act on the selected rows
    ///     they recognize as theirs and silently skip the rest, so one preview replaces what used to
    ///     be two separate dialogs.
    /// </summary>
    internal void ShowPreparationPreview()
    {
        List<PrepareUIInputCandidate> candidates = BuildPreparationCandidates();
        if (candidates.Count == 0)
        {
            SetStatus("No controls are registered yet.");
            return;
        }

        var dialog = new PrepareUIInputsDialog(
            "Prepare interface inputs",
            "Insert a contextual parameter between each registered control and the inputs it " +
                "drives, or beside a disconnected control for later wiring. The type is inferred " +
                "from the control and from the data it currently holds and can be edited before " +
                "applying; item/list access is inferred from the live data. Select Ready or " +
                "Repairable rows and click Place Get inputs, or select already-prepared rows and " +
                "click Remove Get inputs to reconnect and delete them, or Update Get inputs to " +
                "re-apply them - for example after changing a Contextual type.",
            "Place Get inputs",
            candidates,
            ApplyPreparationFromPreview,
            PrepareUIInputGraphService.ClassifyCandidate,
            RefreshPreparationCandidates,
            "Remove Get inputs",
            ApplyRemovalFromPreview,
            "Update Get inputs");
        ShowPreviewWindow(dialog);
    }

    private List<PrepareUIInputCandidate> BuildPreparationCandidates()
    {
        return PrepareUIInputGraphService.BuildPreparationCandidates(ActiveDocument(), _linkedControlIds, _managedLinks);
    }

    private void ApplyPreparationFromPreview(IReadOnlyList<PrepareUIInputCandidate> candidates)
    {
        PrepareUIInputReport report = PrepareUIInputGraphService.ApplyPreparation(this, ActiveDocument(), candidates, _managedLinks);
        SetStatus(Compose(report.Summarize("Preparation"), report), expire: false);
    }

    private void ApplyRemovalFromPreview(IReadOnlyList<PrepareUIInputCandidate> candidates)
    {
        PrepareUIInputReport report = PrepareUIInputGraphService.ApplyRemoval(this, ActiveDocument(), candidates, _managedLinks);
        SetStatus(Compose(report.Summarize("Removal"), report), expire: false);
    }

    private void ShowPreviewWindow(PrepareUIInputsDialog dialog)
    {
        if (_previewWindow != null && !_previewWindow.IsDisposed)
        {
            dialog.Dispose();
            _previewWindow.BringToFront();
            return;
        }

        _previewWindow = dialog;
        dialog.Closed += (sender, arguments) =>
        {
            if (ReferenceEquals(_previewWindow, sender))
            {
                _previewWindow = null;
            }
        };

        // Own the dialog to the Grasshopper canvas itself so it stays above the canvas while the
        // user drags or clicks on it - the main Rhino window (used below as a fallback) is a
        // different top-level window from a floating Grasshopper editor, so owning the dialog to
        // it alone was not enough to keep the dialog above canvas interactions. Topmost was tried
        // instead and rejected: it also pinned the dialog above every other application, not just
        // Rhino/Grasshopper.
        RhinoDoc document = ActiveDocument()?.RhinoDocument ?? RhinoDoc.ActiveDoc;
        dialog.Owner = Instances.EtoDocumentEditor
            ?? (document != null ? RhinoEtoApp.MainWindowForDocument(document) : null);

        dialog.UseRhinoStyle();
        dialog.Show();
    }

    private void ClosePreviewWindow()
    {
        PrepareUIInputsDialog dialog = _previewWindow;
        _previewWindow = null;
        if (dialog == null || dialog.IsDisposed)
        {
            return;
        }

        dialog.Close();
        dialog.Dispose();
    }

    /// <summary>
    ///     Rebuilds the preparation preview from the live document and removes stale registrations
    ///     whose source controls no longer exist. This is deliberately explicit: opening or solving
    ///     a definition never mutates the stored registration list.
    /// </summary>
    private IEnumerable<PrepareUIInputCandidate> RefreshPreparationCandidates()
    {
        GH_Document document = ActiveDocument();
        if (document == null)
        {
            return Array.Empty<PrepareUIInputCandidate>();
        }

        var missing = new HashSet<Guid>(_linkedControlIds.Where(id => document.FindObject(id, true) is not IGH_Param));
        if (missing.Count > 0)
        {
            _linkedControlIds.RemoveAll(missing.Contains);
            _managedLinks.RemoveAll(link => missing.Contains(link.ControlId));
            OnObjectChanged(GH_ObjectEventType.Options);
        }

        return BuildPreparationCandidates();
    }

    private static string Compose(string summary, PrepareUIInputReport report)
    {
        if (report.Messages.Count == 0)
        {
            return summary;
        }

        return summary + " " + string.Join(" ", report.Messages);
    }

    /// <summary>
    ///     Records the outcome and refreshes the component. After a graph operation the solution is
    ///     already scheduled for the whole batch, so <paramref name="expire" /> is false there: one
    ///     scheduled solve per batch, never a second synchronous one on top of it.
    /// </summary>
    private void SetStatus(string status, bool expire = true)
    {
        _status = status;
        OnObjectChanged(GH_ObjectEventType.Options);
        if (expire)
        {
            ExpireSolution(true);
        }

        Instances.RedrawCanvas();
    }

    // ------------------------------------------------------------------
    //  Canvas link rendering support
    // ------------------------------------------------------------------

    /// <summary>Bounds of every registered control, for the dashed selection overlay.</summary>
    internal IReadOnlyList<RectangleF> LinkedControlBounds()
    {
        GH_Document document = ActiveDocument();
        if (document == null)
        {
            return Array.Empty<RectangleF>();
        }

        return _linkedControlIds
            .Select(id => document.FindObject(id, true))
            .Where(documentObject => documentObject?.Attributes != null)
            .Select(documentObject => documentObject.Attributes.Bounds)
            .ToList();
    }

    /// <summary>Bounds of every contextual parameter this component manages.</summary>
    internal IReadOnlyList<RectangleF> ManagedContextualBounds()
    {
        GH_Document document = ActiveDocument();
        if (document == null)
        {
            return Array.Empty<RectangleF>();
        }

        return _managedLinks
            .Select(link => document.FindObject(link.ContextualParameterId, true))
            .Where(documentObject => documentObject?.Attributes != null)
            .Select(documentObject => documentObject.Attributes.Bounds)
            .ToList();
    }

    internal int RegisteredCount => _linkedControlIds.Count;

    private GH_Document ActiveDocument()
    {
        return OnPingDocument() ?? Instances.ActiveCanvas?.Document;
    }

    // ------------------------------------------------------------------
    //  Menu and persistence
    // ------------------------------------------------------------------

    protected override void AppendAdditionalComponentMenuItems(ToolStripDropDown menu)
    {
        base.AppendAdditionalComponentMenuItems(menu);
        Menu_AppendSeparator(menu);
        Menu_AppendItem(menu, "Link selected controls", (sender, arguments) => LinkSelectedControls());
        Menu_AppendItem(menu, "Unlink selected controls", (sender, arguments) => UnlinkSelectedControls());
        Menu_AppendItem(menu, "Clear all registrations", (sender, arguments) => ClearRegistrations());
        Menu_AppendSeparator(menu);
        Menu_AppendItem(menu, "Preview interface inputs...", (sender, arguments) => ShowPreparationPreview());
    }

    public override bool Write(GH_IWriter writer)
    {
        writer.SetString(LinkedControlsKey, string.Join(";", _linkedControlIds.Select(id => id.ToString())));
        writer.SetString(ManagedLinksKey, JsonConvert.SerializeObject(_managedLinks));
        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        _linkedControlIds.Clear();
        if (reader.ItemExists(LinkedControlsKey))
        {
            string[] tokens = reader.GetString(LinkedControlsKey).Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string token in tokens)
            {
                if (Guid.TryParse(token, out Guid id) && !_linkedControlIds.Contains(id))
                {
                    _linkedControlIds.Add(id);
                }
            }
        }

        _managedLinks.Clear();
        if (reader.ItemExists(ManagedLinksKey))
        {
            try
            {
                List<PrepareUIInputManagedLink> stored =
                    JsonConvert.DeserializeObject<List<PrepareUIInputManagedLink>>(reader.GetString(ManagedLinksKey));
                if (stored != null)
                {
                    _managedLinks.AddRange(stored.Where(link => link != null));
                }
            }
            catch
            {
                // A relationship table that cannot be read is dropped rather than guessed at:
                // removal would otherwise operate on nodes it cannot verify.
                _managedLinks.Clear();
            }
        }

        // A registration can exist without a managed link, but never the reverse.
        foreach (PrepareUIInputManagedLink link in _managedLinks)
        {
            if (!_linkedControlIds.Contains(link.ControlId))
            {
                _linkedControlIds.Add(link.ControlId);
            }
        }

        return base.Read(reader);
    }
}
