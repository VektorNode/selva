using System;
using System.Collections.Generic;
using System.Linq;
using Eto.Drawing;
using Eto.Forms;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.GH.Features.UIBuilder.Helpers;

/// <summary>
///     Modeless Eto preview shown before preparing or removing contextual parameters. The rows use
///     ordinary Eto controls inside a Scrollable instead of GridView, whose native renderer crashes
///     Rhino 8 on Windows for this mixed editable table.
/// </summary>
internal sealed class PrepareUIInputsDialog : Form
{
    // Row height shared by every header/cell so the independent per-column TableLayouts (see
    // BuildColumnLayout) line up row-for-row; a mismatched control height in any one column is what
    // desynchronizes the grid.
    private const int RowHeight = 30;

    // Vertical gap between rows within a column (see Column()); InitialWindowSize uses the same
    // value to keep its estimate of the table's height in sync.
    private const int RowSpacing = 4;

    private const int SelectionColumnWidth = 28;
    private const int ControlKindColumnWidth = 260;

    // Pixel step applied per wheel notch when Shift+MouseWheel is used to scroll the table
    // horizontally; the native horizontal scrollbar thumb is too thin to grab reliably.
    private const int HorizontalScrollStep = 40;

    // Row count above which the window opens at its default (tall) height. Below this, the window
    // opens just tall enough for the header plus the rows, so a 1- or 2-row batch doesn't open
    // behind a mostly-empty table - the user can still resize taller or shorter afterwards.
    private const int MaxRowsForShrunkWindow = 8;

    private static readonly Size DefaultWindowSize = new(1080, 500);

    // Remembered across dialog instances (a new PrepareUIInputsDialog is constructed each time the
    // preview is opened), so the window size and column widths survive close/reopen for the life of
    // the Rhino session.
    private static Size? _savedWindowSize;
    private static int[] _savedColumnWidths;

    private readonly List<PrepareUIInputCandidate> _candidates;
    private readonly List<PreviewRow> _rows = new();
    private readonly Action<IReadOnlyList<PrepareUIInputCandidate>> _apply;
    private readonly Action<IReadOnlyList<PrepareUIInputCandidate>> _remove;
    private readonly Action<PrepareUIInputCandidate> _reclassify;
    private readonly Func<IEnumerable<PrepareUIInputCandidate>> _refresh;
    private readonly string _applyCaption;
    private readonly string _reapplyCaption;
    private readonly Scrollable _scrollable;
    private readonly Button _applyButton;
    private readonly Label _summary;
    private readonly Label _detail;
    private CheckBox _selectAllCheckBox;
    private PreviewRow _activeRow;
    private bool _updating;

    internal PrepareUIInputsDialog(
        string title,
        string explanation,
        string applyCaption,
        IEnumerable<PrepareUIInputCandidate> candidates,
        Action<IReadOnlyList<PrepareUIInputCandidate>> apply,
        Action<PrepareUIInputCandidate> reclassify = null,
        Func<IEnumerable<PrepareUIInputCandidate>> refresh = null,
        string removeCaption = null,
        Action<IReadOnlyList<PrepareUIInputCandidate>> remove = null,
        string reapplyCaption = null)
    {
        _candidates = (candidates ?? Enumerable.Empty<PrepareUIInputCandidate>()).ToList();
        _apply = apply;
        _remove = remove;
        _reclassify = reclassify;
        _refresh = refresh;
        _applyCaption = applyCaption;
        _reapplyCaption = reapplyCaption;

        Title = "Prepare UI Inputs - " + title;
        ClientSize = _savedWindowSize ?? InitialWindowSize(_candidates.Count);
        MinimumSize = new Size(820, 380);
        Resizable = true;
        Minimizable = false;
        Maximizable = false;
        ShowInTaskbar = false;

        // Not Topmost: the dialog's Owner (set by the caller via RhinoEtoApp.MainWindowForDocument)
        // already keeps it above the Rhino window it belongs to. Topmost pinned it above every other
        // application on the desktop as well, which is not the intended behaviour.
        SizeChanged += (sender, arguments) => _savedWindowSize = ClientSize;

        var description = new Label
        {
            Text = explanation,
            Wrap = WrapMode.Word,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Left,
        };

        _scrollable = new Scrollable
        {
            Border = BorderType.Bezel,
            ExpandContentWidth = false,
            ExpandContentHeight = true,
        };
        _scrollable.MouseWheel += ScrollHorizontallyOnShiftWheel;

        _detail = new Label
        {
            Wrap = WrapMode.Word,
            TextColor = SystemColors.DisabledText,
            Height = 42,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Left,
        };
        _summary = new Label
        {
            Wrap = WrapMode.Word,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Left,
        };

        _applyButton = new Button { Text = applyCaption };
        var cancelButton = new Button { Text = "Cancel" };
        var refreshButton = new Button { Text = "Refresh", Enabled = _refresh != null };
        _applyButton.Click += (sender, arguments) => ApplyChanges();
        cancelButton.Click += (sender, arguments) => Close();
        refreshButton.Click += (sender, arguments) => RefreshCandidates();

        var buttons = new StackLayout
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalContentAlignment = VerticalAlignment.Center,
            Items = { refreshButton, cancelButton },
        };
        if (_remove != null)
        {
            // Both actions read the same selection and status the rows already carry - Remove
            // reconnects and deletes whichever selected rows are already prepared, Apply inserts or
            // repairs whichever selected rows are not, so one shared preview covers both.
            var removeButton = new Button { Text = removeCaption ?? "Remove" };
            removeButton.Click += (sender, arguments) => RemoveChanges();
            buttons.Items.Add(removeButton);
        }

        buttons.Items.Add(_applyButton);
        var footer = new TableLayout
        {
            Spacing = new Size(12, 0),
            Rows =
            {
                new TableRow(new TableCell(_summary, true), new TableCell(buttons, false))
                {
                    ScaleHeight = false,
                },
            },
        };

        Content = new TableLayout
        {
            Padding = new Padding(12, 10, 12, 14),
            Spacing = new Size(0, 8),
            Rows =
            {
                new TableRow(new TableCell(description, true)) { ScaleHeight = false },
                new TableRow(new TableCell(_scrollable, true)) { ScaleHeight = true },
                new TableRow(new TableCell(_detail, true)) { ScaleHeight = false },
                new TableRow(new TableCell(footer, true)) { ScaleHeight = false },
            },
        };

        RebuildRows();
        UpdateSummary();
        UpdateDetail();
    }

    /// <summary>
    ///     Picks the window's first-open height: at MaxRowsForShrunkWindow rows or more this is just
    ///     DefaultWindowSize, but a smaller batch opens just tall enough for the header and its rows
    ///     instead of always reserving room for a full table.
    /// </summary>
    private static Size InitialWindowSize(int rowCount)
    {
        int shownRows = Math.Max(1, Math.Min(rowCount, MaxRowsForShrunkWindow));
        int tableHeight = (shownRows + 1) * (RowHeight + RowSpacing) + 4;
        int maxTableHeight = (MaxRowsForShrunkWindow + 1) * (RowHeight + RowSpacing) + 4;
        int chromeHeight = DefaultWindowSize.Height - maxTableHeight;
        return new Size(DefaultWindowSize.Width, chromeHeight + tableHeight);
    }

    // Detail is deliberately left out of the column list in BuildColumnLayout: hidden for now,
    // its text still drives the bottom detail label for the active row.
    private void RebuildRows()
    {
        _updating = true;
        try
        {
            _rows.Clear();
            foreach (PrepareUIInputCandidate candidate in _candidates)
            {
                var row = new PreviewRow(candidate, _reclassify != null);
                _rows.Add(row);
                WireRow(row);
            }

            _scrollable.Content = BuildColumnLayout();
            _activeRow = _rows.FirstOrDefault();
        }
        finally
        {
            _updating = false;
        }

        UpdateApplyCaption();
    }

    /// <summary>
    ///     Switches the apply button between "place" and "update" wording depending on whether any
    ///     row in the current batch is already prepared - the same button also repairs/re-adopts an
    ///     already-prepared row (e.g. after its Contextual type is changed in the dropdown), so once
    ///     anything is placed, "Apply preparation" reads as reapplying rather than placing for the
    ///     first time. Re-evaluated on every RebuildRows() call, since Apply/Remove/Refresh can all
    ///     change which rows are already prepared.
    /// </summary>
    private void UpdateApplyCaption()
    {
        if (_reapplyCaption == null)
        {
            return;
        }

        bool anyAlreadyPrepared = _candidates.Any(candidate => candidate.Status == PrepareUIInputStatus.AlreadyPrepared ||
            candidate.Status == PrepareUIInputStatus.Replaceable);
        _applyButton.Text = anyAlreadyPrepared ? _reapplyCaption : _applyCaption;
    }

    /// <summary>
    ///     Columns, not rows: each column is its own vertical strip - a header over one cell per
    ///     row - chained left to right with Eto Splitters so every boundary between columns can be
    ///     dragged. A row-major table has no per-column drag handle in Eto; a column-major chain of
    ///     two-pane splitters does.
    /// </summary>
    private Control BuildColumnLayout()
    {
        (Control Header, int DefaultWidth, Func<PreviewRow, Control> Cell)[] columnDefs =
        {
            (BuildSelectAllHeader(), SelectionColumnWidth, row => row.Selected),
            (HeaderLabel("Source control"), 160, row => row.SourceControl),
            (HeaderLabel("Contextual type"), 210, row => row.Type),
            (HeaderLabel("Access"), 90, row => row.Access),
            (HeaderLabel("Custom name"), 180, row => row.SharedName),
            (HeaderLabel("Control kind"), ControlKindColumnWidth, row => row.ControlKind),
            (HeaderLabel("Current data"), 220, row => row.CurrentData),
            (HeaderLabel("Recip."), 65, row => row.Recipients),
            (HeaderLabel("Status"), 130, row => row.Status),
        };

        if (_savedColumnWidths == null || _savedColumnWidths.Length != columnDefs.Length)
        {
            _savedColumnWidths = columnDefs.Select(column => column.DefaultWidth).ToArray();
        }

        Control[] columnContents = columnDefs.Select(column => Column(column.Header, column.Cell)).ToArray();

        Control chain = columnContents[columnContents.Length - 1];
        for (int index = columnContents.Length - 2; index >= 0; index--)
        {
            int columnIndex = index;
            var splitter = new Splitter
            {
                Orientation = Orientation.Horizontal,
                FixedPanel = SplitterFixedPanel.Panel1,
                Position = _savedColumnWidths[index],
                Panel1 = columnContents[index],
                Panel2 = chain,
            };
            splitter.PositionChanged += (sender, arguments) => _savedColumnWidths[columnIndex] = splitter.Position;
            chain = splitter;
        }

        // Pins the table to the top of the Scrollable's viewport.
        return new TableLayout
        {
            Rows = { new TableRow(new TableCell(chain, false)) { ScaleHeight = false }, new TableRow() },
        };
    }

    private Control Column(Control header, Func<PreviewRow, Control> cell)
    {
        var stack = new TableLayout { Spacing = new Size(0, RowSpacing) };
        stack.Rows.Add(new TableRow(new TableCell(HeaderCell(header), true)) { ScaleHeight = false });
        foreach (PreviewRow row in _rows)
        {
            stack.Rows.Add(new TableRow(new TableCell(CellPadding(cell(row)), true)) { ScaleHeight = false });
        }

        stack.Rows.Add(new TableRow());
        return stack;
    }

    /// <summary>Shaded background band that marks the header row as distinct from the data rows below it.</summary>
    private static Panel HeaderCell(Control header)
    {
        return new Panel
        {
            BackgroundColor = HeaderBackground,
            Padding = new Padding(6, 0),
            Content = header,
        };
    }

    // SystemColors.Control and the default label foreground come from different backends here
    // (Eto/WinForms on Windows, Cocoa on Mac); under Rhino's dark theme Windows returns a dark
    // band with near-black text on it, so the header reads as blank. Derive both from the window
    // background instead, so the contrast holds on either platform and in either theme.
    private static bool IsDarkTheme => Luminance(SystemColors.WindowBackground) < 0.5f;

    private static Color HeaderBackground =>
        IsDarkTheme ? Shift(SystemColors.WindowBackground, 0.10f) : Shift(SystemColors.WindowBackground, -0.07f);

    private static Color HeaderForeground => IsDarkTheme ? Colors.White : Colors.Black;

    private static float Luminance(Color color)
    {
        return (0.299f * color.R) + (0.587f * color.G) + (0.114f * color.B);
    }

    /// <summary>Lightens (positive amount) or darkens (negative) a colour, clamped to the 0-1 range.</summary>
    private static Color Shift(Color color, float amount)
    {
        return new Color(
            Math.Min(1f, Math.Max(0f, color.R + amount)),
            Math.Min(1f, Math.Max(0f, color.G + amount)),
            Math.Min(1f, Math.Max(0f, color.B + amount)));
    }

    private static Control CellPadding(Control cell)
    {
        return new Panel { Padding = new Padding(6, 0), Content = cell };
    }

    private static Label HeaderLabel(string text)
    {
        return new Label
        {
            Text = text,
            Height = RowHeight,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Left,
            Font = SystemFonts.Bold(),
            TextColor = HeaderForeground,
        };
    }

    /// <summary>Header checkbox for the selection column: checks or unchecks every selectable row at once.</summary>
    private Control BuildSelectAllHeader()
    {
        _selectAllCheckBox = new CheckBox
        {
            Height = RowHeight,
            Checked = _rows.Count > 0 && _rows.All(row => row.Selected.Checked == true),
        };
        _selectAllCheckBox.CheckedChanged += (sender, arguments) =>
        {
            if (_updating)
            {
                return;
            }

            ToggleAllSelections(_selectAllCheckBox.Checked == true);
        };
        return _selectAllCheckBox;
    }

    private void ToggleAllSelections(bool select)
    {
        _updating = true;
        try
        {
            foreach (PreviewRow row in _rows)
            {
                if (!IsSelectable(row.Candidate))
                {
                    continue;
                }

                row.Candidate.Selected = select;
                row.Selected.Checked = select;
            }
        }
        finally
        {
            _updating = false;
        }

        UpdateSummary();
    }

    private void SyncSelectAllHeader()
    {
        if (_selectAllCheckBox == null)
        {
            return;
        }

        _updating = true;
        try
        {
            _selectAllCheckBox.Checked = _rows.Count > 0 && _rows.All(row => row.Selected.Checked == true);
        }
        finally
        {
            _updating = false;
        }
    }

    private void ScrollHorizontallyOnShiftWheel(object sender, MouseEventArgs arguments)
    {
        if (!arguments.Modifiers.HasFlag(Keys.Shift))
        {
            return;
        }

        int notches = Math.Sign(arguments.Delta.Height);
        if (notches == 0)
        {
            return;
        }

        Point position = _scrollable.ScrollPosition;
        _scrollable.ScrollPosition = new Point(position.X - notches * HorizontalScrollStep, position.Y);
        arguments.Handled = true;
    }

    private void WireRow(PreviewRow row)
    {
        foreach (Control control in row.VisibleControls)
        {
            control.MouseDown += (sender, arguments) => SetActiveRow(row);
            control.GotFocus += (sender, arguments) => SetActiveRow(row);

            // Every cell is covered by a child control, so the Scrollable itself rarely gets a
            // direct MouseWheel; wire the same shift-to-scroll-horizontally handler on each cell
            // too, so Shift+wheel works no matter which control the pointer is over.
            control.MouseWheel += ScrollHorizontallyOnShiftWheel;
        }

        row.Selected.CheckedChanged += (sender, arguments) =>
        {
            if (_updating)
            {
                return;
            }

            SetActiveRow(row);
            ApplySelectionEdit(row);
            UpdateSummary();
        };
        row.Type.SelectedIndexChanged += (sender, arguments) =>
        {
            if (_updating)
            {
                return;
            }

            SetActiveRow(row);
            ApplyTypeEdit(row);
        };
        row.SharedName.LostFocus += (sender, arguments) =>
        {
            if (!_updating)
            {
                ApplyNameEdit(row);
            }
        };
    }

    private void SetActiveRow(PreviewRow row)
    {
        _activeRow = row;
        UpdateDetail();
    }

    private static bool IsSelectable(PrepareUIInputCandidate candidate)
    {
        return candidate.IsActionable || candidate.Status == PrepareUIInputStatus.AlreadyPrepared;
    }

    private void ApplySelectionEdit(PreviewRow row)
    {
        row.Candidate.Selected = row.Selected.Checked == true && IsSelectable(row.Candidate);
        SyncRow(row);
    }

    private void ApplyTypeEdit(PreviewRow row)
    {
        if (_reclassify == null || row.Type.SelectedIndex < 0)
        {
            return;
        }

        List<PrepareUIInputTypeOption> options = row.Candidate.Options ?? new List<PrepareUIInputTypeOption>();
        if (row.Type.SelectedIndex >= options.Count)
        {
            return;
        }

        row.Candidate.SelectedType = options[row.Type.SelectedIndex].Type;
        _reclassify(row.Candidate);
        SyncRow(row);
        UpdateSummary();
        UpdateDetail();
    }

    private void ApplyNameEdit(PreviewRow row)
    {
        if (_reclassify == null)
        {
            return;
        }

        row.Candidate.ControlNickName = PrepareUIInputInference.CleanNickName(
            row.SharedName.Text,
            row.Candidate.OriginalControlNickName);
        _reclassify(row.Candidate);
        SyncRow(row);
        UpdateSummary();
        UpdateDetail();
    }

    private void SyncRow(PreviewRow row)
    {
        _updating = true;
        try
        {
            PrepareUIInputCandidate candidate = row.Candidate;
            row.Selected.Enabled = IsSelectable(candidate);
            row.Selected.Checked = candidate.Selected;
            row.SourceControl.Text = candidate.OriginalControlNickName;
            row.ControlKind.Text = PrepareUIInputInference.Describe(candidate.Kind);
            row.CurrentData.Text = candidate.Profile?.Describe() ?? string.Empty;
            row.Access.Text = candidate.AccessName;
            row.SharedName.Text = candidate.ControlNickName;
            row.Recipients.Text = candidate.RecipientCount.ToString();
            row.Status.Text = candidate.StatusText;
            row.Note.Text = candidate.Note;

            List<PrepareUIInputTypeOption> options = candidate.Options ?? new List<PrepareUIInputTypeOption>();
            row.Type.DataStore = options.Count == 0
                ? new[] { candidate.TypeName }
                : options.Select(option => option.Label).ToArray();
            int selectedIndex = options.FindIndex(option => option.Type == candidate.SelectedType);
            row.Type.SelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
            row.Type.Enabled = _reclassify != null && options.Count > 0;
        }
        finally
        {
            _updating = false;
        }
    }

    /// <summary>
    ///     Commits every row's live edits before Apply/Remove reads _candidates.
    ///
    ///     The checkbox is captured *before* ApplyNameEdit runs, not read fresh afterwards:
    ///     ApplyNameEdit reclassifies the candidate (needed so a renamed row's Status/Note are
    ///     current before applying), and ClassifyCandidate resets Selected to its own recommended
    ///     default as part of that - which silently dropped a manually-checked row (this is exactly
    ///     why Remove Get inputs did nothing when a user checked an already-prepared row: the
    ///     checkbox's own row still visually showed checked, but ApplyNameEdit's reclassify had
    ///     already reset the checkbox back to unchecked and the underlying candidate.Selected to
    ///     false, so ApplyRemoval saw nothing selected). The checkbox the user actually looked at is
    ///     the real source of truth, so it is captured first and reasserted afterwards.
    /// </summary>
    private void CommitRows()
    {
        Dictionary<PreviewRow, bool> intendedSelection = _rows.ToDictionary(row => row, row => row.Selected.Checked == true);

        foreach (PreviewRow row in _rows)
        {
            ApplyNameEdit(row);
        }

        // Restore the checkboxes to what the user actually set, without re-triggering
        // CheckedChanged (guarded the same way SyncRow guards its own programmatic updates), then
        // commit that restored state deterministically in a single pass below.
        _updating = true;
        try
        {
            foreach (PreviewRow row in _rows)
            {
                row.Selected.Checked = intendedSelection[row];
            }
        }
        finally
        {
            _updating = false;
        }

        foreach (PreviewRow row in _rows)
        {
            ApplySelectionEdit(row);
        }
    }

    /// <summary>
    ///     Applies the batch and refreshes the candidate list in place instead of closing the
    ///     window, so the user can keep reviewing or apply another batch without reopening the
    ///     preview.
    /// </summary>
    private void ApplyChanges()
    {
        CommitRows();
        try
        {
            _apply?.Invoke(_candidates);
        }
        finally
        {
            RefreshCandidates();
        }
    }

    /// <summary>
    ///     Removes the batch and refreshes the candidate list in place, mirroring ApplyChanges. The
    ///     same selection and rows are shared with Apply - PrepareUIInputGraphService.ApplyRemoval
    ///     already skips any selected row that is not an already-prepared, unambiguous link, so
    ///     selecting a mix of not-yet-prepared and already-prepared rows and pressing either button
    ///     only acts on the rows that button actually applies to.
    /// </summary>
    private void RemoveChanges()
    {
        CommitRows();
        try
        {
            _remove?.Invoke(_candidates);
        }
        finally
        {
            RefreshCandidates();
        }
    }

    private void RefreshCandidates()
    {
        if (_refresh == null)
        {
            return;
        }

        _candidates.Clear();
        _candidates.AddRange(_refresh() ?? Enumerable.Empty<PrepareUIInputCandidate>());
        RebuildRows();
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
        string renamedSuffix = renamed > 0 ? $"; {renamed} custom name edit(s)" : string.Empty;
        string blockedSuffix = blocked > 0 ? $"; {blocked} left untouched for review." : ".";
        _summary.Text = $"{selected} of {_candidates.Count} row(s) selected{overriddenSuffix}{renamedSuffix}{blockedSuffix}";
        SyncSelectAllHeader();
    }

    private void UpdateDetail()
    {
        PrepareUIInputCandidate candidate = _activeRow?.Candidate;
        if (candidate == null)
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

    private sealed class PreviewRow
    {
        internal PreviewRow(PrepareUIInputCandidate candidate, bool editable)
        {
            Candidate = candidate;
            Selected = new CheckBox
            {
                Checked = candidate.Selected,
                Enabled = IsSelectable(candidate),
                Height = RowHeight,
            };
            SourceControl = Text(candidate.OriginalControlNickName);
            ControlKind = Text(PrepareUIInputInference.Describe(candidate.Kind));
            CurrentData = Text(candidate.Profile?.Describe() ?? string.Empty);
            Type = new DropDown { Enabled = editable };
            Access = Text(candidate.AccessName);
            SharedName = new TextBox { Text = candidate.ControlNickName, ReadOnly = !editable };
            Recipients = Text(candidate.RecipientCount.ToString());
            Status = Text(candidate.StatusText);
            Note = Text(candidate.Note);

            List<PrepareUIInputTypeOption> options = candidate.Options ?? new List<PrepareUIInputTypeOption>();
            Type.DataStore = options.Count == 0
                ? new[] { candidate.TypeName }
                : options.Select(option => option.Label).ToArray();
            int selectedIndex = options.FindIndex(option => option.Type == candidate.SelectedType);
            Type.SelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
            Type.Enabled = editable && options.Count > 0;
        }

        internal PrepareUIInputCandidate Candidate { get; }
        internal CheckBox Selected { get; }
        internal Label SourceControl { get; }
        internal Label ControlKind { get; }
        internal Label CurrentData { get; }
        internal DropDown Type { get; }
        internal Label Access { get; }
        internal TextBox SharedName { get; }
        internal Label Recipients { get; }
        internal Label Status { get; }
        internal Label Note { get; }

        /// <summary>Every cell actually placed in the grid. Note is excluded: it is not shown.</summary>
        internal IEnumerable<Control> VisibleControls
        {
            get
            {
                yield return Selected;
                yield return SourceControl;
                yield return ControlKind;
                yield return CurrentData;
                yield return Type;
                yield return Access;
                yield return SharedName;
                yield return Recipients;
                yield return Status;
            }
        }

        private static Label Text(string value)
        {
            return new Label
            {
                Text = value ?? string.Empty,
                Height = RowHeight,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Left,
            };
        }
    }
}
