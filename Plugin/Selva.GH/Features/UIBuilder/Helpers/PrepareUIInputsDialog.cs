using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.GH.Features.UIBuilder.Helpers;

/// <summary>
///     The preview table shown before either mutation: source control, what it is currently
///     carrying, the contextual type, inferred item/list access, editable shared name, recipient
///     count, and status, with a checkbox per row so individual candidates can be excluded.
///
///     The contextual type is editable; changing it re-runs the classification, because a
///     different type can turn a reusable node into an ambiguous one and that has to be visible
///     before Apply. This is an owned modeless tool window: it remains above Grasshopper while
///     leaving the canvas available for selection, pan, zoom, and edits. Refresh explicitly
///     reconciles those live canvas changes before Apply.
/// </summary>
internal sealed class PrepareUIInputsDialog : Form
{
    private const string SelectColumn = "select";
    private const string NameColumn = "name";
    private const string TypeColumn = "type";
    private const string StatusColumn = "status";
    private const string NoteColumn = "note";

    private readonly List<PrepareUIInputCandidate> _candidates;
    private readonly Action<IReadOnlyList<PrepareUIInputCandidate>> _apply;
    private readonly Action<PrepareUIInputCandidate> _reclassify;
    private readonly Func<IEnumerable<PrepareUIInputCandidate>> _refresh;
    private readonly DataGridView _grid;
    private readonly Label _summary;
    private readonly Label _detail;
    private bool _updating;

    /// <param name="reclassify">
    ///     Re-runs the graph classification for one candidate after its type or name changed. Null
    ///     for the removal preview, where the type is fixed by the stored relationship.
    /// </param>
    internal PrepareUIInputsDialog(
        string title,
        string explanation,
        string applyCaption,
        IEnumerable<PrepareUIInputCandidate> candidates,
        Action<IReadOnlyList<PrepareUIInputCandidate>> apply,
        Action<PrepareUIInputCandidate> reclassify = null,
        Func<IEnumerable<PrepareUIInputCandidate>> refresh = null)
    {
        _candidates = (candidates ?? Enumerable.Empty<PrepareUIInputCandidate>()).ToList();
        _apply = apply;
        _reclassify = reclassify;
        _refresh = refresh;

        Text = "Prepare UI Inputs - " + title;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.SizableToolWindow;
        ClientSize = new Size(1080, 500);
        MinimumSize = new Size(820, 380);

        var description = new Label
        {
            Dock = DockStyle.Top,
            Padding = new Padding(12, 10, 12, 6),
            Height = 46,
            Text = explanation,
        };

        _grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            MultiSelect = false,
            EditMode = DataGridViewEditMode.EditOnEnter,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
            ScrollBars = ScrollBars.Both,
            BackgroundColor = SystemColors.Window,
        };
        BuildColumns();
        FillRows();
        _grid.CellValueChanged += OnCellValueChanged;
        _grid.SelectionChanged += (sender, arguments) => UpdateDetail();

        // A combo or checkbox edit is otherwise only committed when the cell loses focus.
        _grid.CurrentCellDirtyStateChanged += (sender, arguments) =>
        {
            if (_grid.IsCurrentCellDirty)
            {
                _grid.CommitEdit(DataGridViewDataErrorContexts.Commit);
            }
        };

        // A combo cell whose value is briefly out of its item list must not raise a modal error box
        // at the author; the value is corrected in OnCellValueChanged instead.
        _grid.DataError += (sender, arguments) => arguments.ThrowException = false;

        _detail = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 38,
            Padding = new Padding(12, 4, 12, 4),
            ForeColor = SystemColors.GrayText,
        };

        _summary = new Label
        {
            Dock = DockStyle.Fill,
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(4, 0, 0, 0),
        };

        var applyButton = new Button { Text = applyCaption, AutoSize = true, Padding = new Padding(10, 3, 10, 3) };
        var cancelButton = new Button { Text = "Cancel", AutoSize = true, Padding = new Padding(10, 3, 10, 3) };
        var refreshButton = new Button
        {
            Text = "Refresh",
            AutoSize = true,
            Padding = new Padding(10, 3, 10, 3),
            Enabled = _refresh != null,
        };

        var buttonRow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
        };
        buttonRow.Controls.Add(applyButton);
        buttonRow.Controls.Add(cancelButton);
        buttonRow.Controls.Add(refreshButton);

        // A two-cell table rather than two docked panels: docking order inside a plain Panel is
        // z-order dependent and easy to get subtly wrong.
        var footer = new TableLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 58,
            ColumnCount = 2,
            RowCount = 1,
            Padding = new Padding(12, 8, 14, 14),
        };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        footer.Controls.Add(_summary, 0, 0);
        footer.Controls.Add(buttonRow, 1, 0);

        Controls.Add(_grid);
        Controls.Add(_detail);
        Controls.Add(footer);
        Controls.Add(description);

        AcceptButton = applyButton;
        CancelButton = cancelButton;
        applyButton.Click += (sender, arguments) => ApplyAndClose();
        cancelButton.Click += (sender, arguments) => Close();
        refreshButton.Click += (sender, arguments) => RefreshCandidates();
        UpdateSummary();
        UpdateDetail();
    }

    private void BuildColumns()
    {
        _grid.Columns.Add(new DataGridViewCheckBoxColumn
        {
            Name = SelectColumn,
            HeaderText = string.Empty,
            Width = 34,
            FillWeight = 5,
            AutoSizeMode = DataGridViewAutoSizeColumnMode.None,
        });
        AddTextColumn("control", "Source control", 160);
        AddTextColumn("kind", "Control kind", 180);
        AddTextColumn("data", "Current data", 220);
        _grid.Columns.Add(new DataGridViewComboBoxColumn
        {
            Name = TypeColumn,
            HeaderText = "Contextual type",
            Width = 210,
            DisplayStyle = DataGridViewComboBoxDisplayStyle.DropDownButton,
            FlatStyle = FlatStyle.Flat,
            SortMode = DataGridViewColumnSortMode.NotSortable,
        });
        AddTextColumn("access", "Access", 90);
        AddTextColumn(NameColumn, "Shared name", 180, _reclassify == null);
        AddTextColumn("recipients", "Recip.", 65);
        AddTextColumn(StatusColumn, "Status", 130);
        AddTextColumn(NoteColumn, "Detail", 360);
    }

    private void AddTextColumn(string name, string header, int width, bool readOnly = true)
    {
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = name,
            HeaderText = header,
            Width = width,
            ReadOnly = readOnly,
            SortMode = DataGridViewColumnSortMode.NotSortable,
        });
    }

    private void FillRows()
    {
        _updating = true;
        foreach (PrepareUIInputCandidate candidate in _candidates)
        {
            int index = _grid.Rows.Add();
            DataGridViewRow row = _grid.Rows[index];
            row.Tag = candidate;

            row.Cells["control"].Value = candidate.OriginalControlNickName;
            row.Cells["kind"].Value = PrepareUIInputInference.Describe(candidate.Kind);
            row.Cells["data"].Value = candidate.Profile?.Describe() ?? string.Empty;
            row.Cells["access"].Value = candidate.AccessName;
            row.Cells[NameColumn].Value = candidate.ControlNickName;
            row.Cells["recipients"].Value = candidate.RecipientCount.ToString();

            PopulateTypeCell(row, candidate);
            ApplyRowState(row, candidate);
        }

        _updating = false;
    }

    /// <summary>
    ///     The drop-down carries only the types compatible with this control, so a Boolean Toggle
    ///     never offers Get Value List. Unavailable providers stay listed and are labelled as such
    ///     rather than silently missing.
    /// </summary>
    private void PopulateTypeCell(DataGridViewRow row, PrepareUIInputCandidate candidate)
    {
        var cell = (DataGridViewComboBoxCell)row.Cells[TypeColumn];
        cell.Items.Clear();

        List<PrepareUIInputTypeOption> options = candidate.Options ?? new List<PrepareUIInputTypeOption>();
        if (options.Count == 0)
        {
            // Removal rows, and unsupported controls, have a fixed type: show it, do not offer a
            // choice that cannot be honoured.
            cell.Items.Add(candidate.TypeName);
            cell.Value = candidate.TypeName;
            cell.ReadOnly = true;
            return;
        }

        foreach (PrepareUIInputTypeOption option in options)
        {
            cell.Items.Add(option.Label);
        }

        PrepareUIInputTypeOption current = options.FirstOrDefault(option => option.Type == candidate.SelectedType) ?? options[0];
        candidate.SelectedType = current.Type;
        cell.Value = current.Label;
        cell.ReadOnly = _reclassify == null || options.Count < 2;
    }

    /// <summary>Status, detail, checkbox and greying, recomputed after any edit.</summary>
    private void ApplyRowState(DataGridViewRow row, PrepareUIInputCandidate candidate)
    {
        row.Cells[StatusColumn].Value = candidate.StatusText;
        row.Cells[NoteColumn].Value = candidate.Note;
        row.Cells[SelectColumn].Value = candidate.Selected;

        bool selectable = candidate.Selected || candidate.IsActionable || candidate.Status == PrepareUIInputStatus.AlreadyPrepared;
        row.Cells[SelectColumn].ReadOnly = !selectable;

        // A row that cannot be acted on is greyed out rather than hidden, so the author can see why
        // a control was left alone, and can still change its type to try to fix it.
        bool blocked = candidate.Status is PrepareUIInputStatus.Ambiguous or PrepareUIInputStatus.MissingDependency
            or PrepareUIInputStatus.ControlMissing or PrepareUIInputStatus.Unused;
        row.DefaultCellStyle.ForeColor = blocked ? SystemColors.GrayText : SystemColors.ControlText;
        row.DefaultCellStyle.BackColor = blocked ? Color.FromArgb(246, 246, 246) : SystemColors.Window;
    }

    private void OnCellValueChanged(object sender, DataGridViewCellEventArgs arguments)
    {
        if (_updating || arguments.RowIndex < 0 || arguments.ColumnIndex < 0)
        {
            return;
        }

        DataGridViewRow row = _grid.Rows[arguments.RowIndex];
        if (row.Tag is not PrepareUIInputCandidate candidate)
        {
            return;
        }

        string column = _grid.Columns[arguments.ColumnIndex].Name;
        _updating = true;
        try
        {
            switch (column)
            {
                case SelectColumn:
                    ApplySelectionEdit(row, candidate);
                    break;
                case TypeColumn:
                    ApplyTypeEdit(row, candidate);
                    break;
                case NameColumn:
                    ApplyNameEdit(row, candidate);
                    break;
            }
        }
        finally
        {
            _updating = false;
        }

        UpdateSummary();
        UpdateDetail();
    }

    private static void ApplySelectionEdit(DataGridViewRow row, PrepareUIInputCandidate candidate)
    {
        bool requested = row.Cells[SelectColumn].Value is true;
        bool selectable = candidate.IsActionable || candidate.Status == PrepareUIInputStatus.AlreadyPrepared;
        candidate.Selected = requested && selectable;
        if (candidate.Selected != requested)
        {
            row.Cells[SelectColumn].Value = candidate.Selected;
        }
    }

    /// <summary>
    ///     Applies a type override and re-runs the classification. The re-classification also resets
    ///     the row's own checkbox, which is the honest behavior: choosing a type that clashes with a
    ///     node already on the canvas makes the row unusable, and it should not stay ticked.
    /// </summary>
    private void ApplyTypeEdit(DataGridViewRow row, PrepareUIInputCandidate candidate)
    {
        string label = row.Cells[TypeColumn].Value as string;
        PrepareUIInputTypeOption option = (candidate.Options ?? new List<PrepareUIInputTypeOption>())
            .FirstOrDefault(entry => entry.Label == label);
        if (option == null)
        {
            row.Cells[TypeColumn].Value = candidate.Options?.FirstOrDefault(entry => entry.Type == candidate.SelectedType)?.Label;
            return;
        }

        candidate.SelectedType = option.Type;
        _reclassify?.Invoke(candidate);
        ApplyRowState(row, candidate);
    }

    private void ApplyNameEdit(DataGridViewRow row, PrepareUIInputCandidate candidate)
    {
        string requested = Convert.ToString(row.Cells[NameColumn].Value) ?? string.Empty;
        string cleaned = PrepareUIInputInference.CleanNickName(requested, candidate.OriginalControlNickName);

        candidate.ControlNickName = cleaned;
        row.Cells[NameColumn].Value = cleaned;
        _reclassify?.Invoke(candidate);
        ApplyRowState(row, candidate);
    }

    /// <summary>
    ///     Writes the checkbox state back onto the candidate objects the caller will act on. Called
    ///     on Apply so a row edited but never committed by the grid still counts.
    /// </summary>
    private void CommitSelection()
    {
        _grid.EndEdit();
        foreach (DataGridViewRow row in _grid.Rows)
        {
            if (row.Tag is PrepareUIInputCandidate candidate)
            {
                bool requested = row.Cells[SelectColumn].Value is true;
                candidate.Selected = requested && (candidate.IsActionable || candidate.Status == PrepareUIInputStatus.AlreadyPrepared);
            }
        }
    }

    private void ApplyAndClose()
    {
        CommitSelection();
        try
        {
            _apply?.Invoke(_candidates);
        }
        finally
        {
            Close();
        }
    }

    private void RefreshCandidates()
    {
        if (_refresh == null)
        {
            return;
        }

        _grid.EndEdit();
        IEnumerable<PrepareUIInputCandidate> refreshed = _refresh();
        _candidates.Clear();
        _candidates.AddRange(refreshed ?? Enumerable.Empty<PrepareUIInputCandidate>());
        _grid.Rows.Clear();
        FillRows();
        UpdateSummary();
        UpdateDetail();
    }

    private void UpdateSummary()
    {
        int selected = _candidates.Count(candidate => candidate.Selected);
        int blocked = _candidates.Count(candidate => candidate.Status is PrepareUIInputStatus.Ambiguous
            or PrepareUIInputStatus.MissingDependency or PrepareUIInputStatus.ControlMissing);
        int overridden = _candidates.Count(candidate => candidate.TypeOverridden);
        int renamed = _candidates.Count(candidate => candidate.NameChanged);

        string overriddenSuffix = overridden > 0 ? $"; {overridden} type override(s)" : string.Empty;
        string renamedSuffix = renamed > 0 ? $"; {renamed} shared name edit(s)" : string.Empty;
        string blockedSuffix = blocked > 0 ? $"; {blocked} left untouched for review." : ".";
        _summary.Text = $"{selected} of {_candidates.Count} row(s) selected{overriddenSuffix}{renamedSuffix}{blockedSuffix}";
    }

    /// <summary>
    ///     What choosing the currently highlighted row's type actually means. The consequence of
    ///     picking Get Integer for a decimal panel belongs somewhere the author reads before
    ///     applying, not in a tooltip they may never open.
    /// </summary>
    private void UpdateDetail()
    {
        if (_grid.CurrentRow?.Tag is not PrepareUIInputCandidate candidate)
        {
            _detail.Text = string.Empty;
            return;
        }

        PrepareUIInputTypeOption option = (candidate.Options ?? new List<PrepareUIInputTypeOption>())
            .FirstOrDefault(entry => entry.Type == candidate.SelectedType);
        string consequence = string.IsNullOrEmpty(option?.Note) ? string.Empty : $"  {candidate.TypeName}: {option.Note}.";
        string detected = candidate.RecommendedType == null || !candidate.TypeOverridden
            ? string.Empty
            : $"  Detected type was {candidate.RecommendedType.DisplayName}.";
        _detail.Text = $"{candidate.ControlNickName} - {candidate.Profile?.Describe() ?? "no data"}.{consequence}{detected}";
    }
}
