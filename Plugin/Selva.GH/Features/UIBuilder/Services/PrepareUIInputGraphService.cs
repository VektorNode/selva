using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Undo;
using Grasshopper.Kernel.Undo.Actions;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Graph planning and the two mutating operations for Prepare UI Inputs: insertion and removal.
///     Every mutation here is an intentional document edit triggered by a canvas button; nothing in
///     this class is reachable from SolveInstance. Wires are re-routed with IGH_Param.ReplaceSource,
///     which preserves wire order and every other source a recipient already had, and each batch is
///     one GH_UndoRecord plus one scheduled solution.
/// </summary>
internal static class PrepareUIInputGraphService
{
    private const float InsertionGap = 18f;
    private const float CollisionStep = 26f;
    private const int CollisionAttempts = 16;

    // ------------------------------------------------------------------
    //  Planning (read-only)
    // ------------------------------------------------------------------

    /// <summary>
    ///     Classifies every registered control against the live graph. Pure inspection: no object is
    ///     created, moved, wired, or expired, so this is safe to call for a preview or for the
    ///     component's own summary output.
    /// </summary>
    internal static List<PrepareUIInputCandidate> BuildPreparationCandidates(
        GH_Document document,
        IReadOnlyList<Guid> linkedControlIds,
        IReadOnlyList<PrepareUIInputManagedLink> managedLinks)
    {
        var candidates = new List<PrepareUIInputCandidate>();
        if (document == null)
        {
            return candidates;
        }

        foreach (Guid controlId in linkedControlIds)
        {
            var candidate = new PrepareUIInputCandidate { ControlId = controlId };
            candidate.ExistingLink = managedLinks.FirstOrDefault(link => link.ControlId == controlId);

            if (document.FindObject(controlId, true) is not IGH_Param control)
            {
                candidate.Status = PrepareUIInputStatus.ControlMissing;
                candidate.ControlNickName = candidate.ExistingLink?.ControlNickName ??
                    controlId.ToString("N").Substring(0, 8);
                candidate.OriginalControlNickName = candidate.ControlNickName;
                candidate.Note = "The registered control is no longer in this document. It is " +
                    "never remapped to another object automatically.";
                candidates.Add(candidate);
                continue;
            }

            candidate.OriginalControlNickName = PrepareUIInputTypeResolver.DisplayName(control);
            candidate.ControlNickName = candidate.OriginalControlNickName;
            candidate.Kind = PrepareUIInputTypeResolver.Classify(control);

            // What the control is actually carrying decides the recommendation for the kinds that
            // can hold more than one shape of value - a Panel above all.
            candidate.Profile = PrepareUIInputTypeResolver.Inspect(control);
            candidate.Options = PrepareUIInputTypeResolver.Options(candidate.Kind, candidate.Profile);
            candidate.RecommendedType = PrepareUIInputTypeResolver.Recommend(candidate.Kind, candidate.Profile);

            // A previous run's deliberate override wins over the fresh inference, so reopening the
            // preview does not quietly reset a choice the author already made.
            PrepareUIInputContextualType stored = candidate.ExistingLink == null
                ? null
                : PrepareUIInputInference.FromGuid(candidate.ExistingLink.ContextualTypeGuid);
            candidate.SelectedType = candidate.ExistingLink?.TypeOverridden == true && stored != null
                ? stored
                : candidate.RecommendedType;
            candidate.Access = candidate.Profile != null && candidate.Profile.IsList
                ? GH_ParamAccess.list
                : GH_ParamAccess.item;

            // Recipients are split before anything else: a contextual parameter downstream of the
            // control is a candidate for reuse, everything else is a wire to re-route.
            List<IGH_Param> recipients = control.Recipients?.ToList() ?? new List<IGH_Param>();
            candidate.ContextualRecipients.AddRange(recipients.Where(recipient => recipient is IGH_ContextualParameter));
            candidate.DirectRecipients.AddRange(recipients.Except(candidate.ContextualRecipients));

            // A single existing contextual parameter is the strongest evidence of the author's
            // intent. Preserve its compatible type as the preview default, even when today's source
            // data would infer a different recommendation; the recommendation is retained separately
            // so the override stays visible.
            if (candidate.ContextualRecipients.Count == 1)
            {
                IGH_Param existing = candidate.ContextualRecipients[0];
                PrepareUIInputContextualType existingType = PrepareUIInputInference.FromGuid(existing.ComponentGuid);
                bool compatible = candidate.Options.Any(option => option.Type.TypeGuid == existing.ComponentGuid);
                if (existingType != null && compatible)
                {
                    candidate.SelectedType = existingType;
                }
            }

            ClassifyCandidate(candidate);
            candidates.Add(candidate);
        }

        return candidates;
    }

    /// <summary>
    ///     Decides a candidate's status from its currently selected type and the live wiring. Split
    ///     out of the planning loop so the preview dialog can call it again whenever the author
    ///     changes the type or access in the drop-down: a different type can turn an "Already
    ///     prepared" row into "Ambiguous", and the author needs to see that before applying. The
    ///     actual decision table is PrepareUIInputInference.DecideStatus; this method only gathers
    ///     the primitives it needs from the live candidate.
    /// </summary>
    internal static void ClassifyCandidate(PrepareUIInputCandidate candidate)
    {
        if (candidate == null || candidate.Status == PrepareUIInputStatus.ControlMissing)
        {
            return;
        }

        candidate.Selected = false;

        Guid? existingTypeGuid = null;
        string existingName = string.Empty;
        bool nickNameDrifted = false;
        bool accessChanged = false;
        if (candidate.ContextualRecipients.Count == 1)
        {
            IGH_Param existing = candidate.ContextualRecipients[0];
            candidate.ExistingContextualParameter = existing;
            existingTypeGuid = existing.ComponentGuid;
            existingName = existing.Name;
            nickNameDrifted = existing.NickName != candidate.ControlNickName;
            accessChanged = existing.Access != candidate.Access;
        }
        else
        {
            candidate.ExistingContextualParameter = null;
        }

        bool selectedTypeAvailable = candidate.SelectedType != null &&
            PrepareUIInputTypeResolver.IsAvailable(candidate.SelectedType);

        PrepareUIInputDecision decision = PrepareUIInputInference.DecideStatus(
            candidate.SelectedType,
            selectedTypeAvailable,
            PrepareUIInputInference.Describe(candidate.Kind),
            candidate.DirectRecipients.Count,
            candidate.ContextualRecipients.Count,
            candidate.ControlNickName,
            candidate.AccessName,
            candidate.TypeOverridden,
            candidate.RecommendedType?.DisplayName,
            existingTypeGuid,
            existingName,
            nickNameDrifted,
            candidate.NameChanged,
            accessChanged,
            candidate.ExistingLink != null);

        candidate.Status = decision.Status;
        candidate.Note = decision.Note;
        candidate.Selected = decision.Selected;
    }

    /// <summary>
    ///     Classifies every managed link for removal. A link only becomes actionable when the graph
    ///     still matches what was recorded: the control still feeds the contextual parameter, that
    ///     parameter has no other source, and its type is unchanged. Anything else is Ambiguous and
    ///     is left alone.
    /// </summary>
    internal static List<PrepareUIInputCandidate> BuildRemovalCandidates(
        GH_Document document,
        IReadOnlyList<PrepareUIInputManagedLink> managedLinks)
    {
        var candidates = new List<PrepareUIInputCandidate>();
        if (document == null)
        {
            return candidates;
        }

        foreach (PrepareUIInputManagedLink link in managedLinks)
        {
            PrepareUIInputContextualType selectedType = PrepareUIInputInference.FromGuid(link.ContextualTypeGuid) ??
                new PrepareUIInputContextualType(link.ContextualTypeGuid, link.ContextualTypeName, string.Empty);
            var candidate = new PrepareUIInputCandidate
            {
                ControlId = link.ControlId,
                OriginalControlNickName = link.ControlNickName,
                ControlNickName = link.ControlNickName,
                ExistingLink = link,
                SelectedType = selectedType,
                Access = string.Equals(link.Access, "list", StringComparison.OrdinalIgnoreCase)
                    ? GH_ParamAccess.list
                    : GH_ParamAccess.item,
            };
            if (Enum.TryParse(link.ControlKind, out PrepareUIInputControlKind kind))
            {
                candidate.Kind = kind;
            }

            IGH_Param control = document.FindObject(link.ControlId, true) as IGH_Param;
            IGH_Param contextual = document.FindObject(link.ContextualParameterId, true) as IGH_Param;
            candidate.Profile = PrepareUIInputTypeResolver.Inspect(control);

            if (contextual == null)
            {
                // Nothing to undo on the canvas; the stale bookkeeping row is dropped instead.
                candidate.Status = PrepareUIInputStatus.AlreadyPrepared;
                candidate.Note = "The contextual parameter is already gone. Removing clears the " +
                    "stored relationship only.";
                candidate.Selected = true;
                candidates.Add(candidate);
                continue;
            }

            candidate.ExistingContextualParameter = contextual;
            candidate.DirectRecipients.AddRange(contextual.Recipients?.ToList() ?? new List<IGH_Param>());

            if (control == null)
            {
                candidate.Status = PrepareUIInputStatus.Ambiguous;
                candidate.Note = "The original control is gone, so its wiring cannot be restored. " +
                    "The contextual parameter is left in place.";
            }
            else if (contextual.ComponentGuid != link.ContextualTypeGuid)
            {
                candidate.Status = PrepareUIInputStatus.Ambiguous;
                candidate.Note = "The contextual parameter's type no longer matches the stored relationship.";
            }
            else if (contextual.Sources == null || contextual.Sources.All(source => source.InstanceGuid != link.ControlId))
            {
                candidate.Status = PrepareUIInputStatus.Ambiguous;
                candidate.Note = "The original control no longer feeds this contextual parameter; " +
                    "it appears to have been repurposed.";
            }
            else if (contextual.SourceCount > 1)
            {
                candidate.Status = PrepareUIInputStatus.Ambiguous;
                candidate.Note = $"The contextual parameter has {contextual.SourceCount} sources. " +
                    "Only a single-source relationship can be reversed safely.";
            }
            else
            {
                candidate.Status = PrepareUIInputStatus.Ready;
                candidate.Note = $"Reconnect the control to {candidate.DirectRecipients.Count} " +
                    $"recipient input(s), then delete '{contextual.NickName}'.";
                candidate.Selected = true;
            }

            candidates.Add(candidate);
        }

        return candidates;
    }

    // ------------------------------------------------------------------
    //  Insertion
    // ------------------------------------------------------------------

    /// <summary>
    ///     Inserts or repairs the selected contextual parameters as one grouped, undoable batch and
    ///     schedules a single solution afterwards.
    /// </summary>
    internal static PrepareUIInputReport ApplyPreparation(
        GH_Component owner,
        GH_Document document,
        IReadOnlyList<PrepareUIInputCandidate> candidates,
        List<PrepareUIInputManagedLink> managedLinks)
    {
        var report = new PrepareUIInputReport();
        if (document == null)
        {
            report.Messages.Add("No active Grasshopper document was found.");
            return report;
        }

        var record = new GH_UndoRecord("Selva Prepare UI Inputs: insert contextual inputs");
        var expired = new List<IGH_Param>();
        bool mutated = false;

        // One shared column edge for the whole batch: every parameter inserted here starts at the
        // same X, so a row of prepared sliders gets one clean aligned column instead of a staircase
        // driven by each slider's own width.
        List<IGH_Param> readyControls = (candidates ?? Array.Empty<PrepareUIInputCandidate>())
            .Where(candidate => candidate.Selected && candidate.Status == PrepareUIInputStatus.Ready)
            .Select(candidate => document.FindObject(candidate.ControlId, true) as IGH_Param)
            .Where(readyControl => readyControl != null)
            .ToList();
        float columnLeadingEdge = ResolveColumnLeadingEdge(readyControls);

        foreach (PrepareUIInputCandidate candidate in candidates ?? Array.Empty<PrepareUIInputCandidate>())
        {
            if (!candidate.Selected)
            {
                report.Skipped++;
                continue;
            }

            if (document.FindObject(candidate.ControlId, true) is not IGH_Param control)
            {
                report.Failed++;
                report.Messages.Add($"{candidate.ControlNickName}: the control disappeared before the operation ran.");
                continue;
            }

            try
            {
                switch (candidate.Status)
                {
                    case PrepareUIInputStatus.Ready:
                        mutated |= InsertContextualParameter(
                            document, record, control, candidate, report, expired, managedLinks, columnLeadingEdge);
                        break;
                    case PrepareUIInputStatus.Repairable:
                        mutated |= RepairContextualParameter(record, control, candidate, report, expired, managedLinks);
                        break;
                    case PrepareUIInputStatus.AlreadyPrepared when candidate.ExistingContextualParameter != null:
                        // Bookkeeping-only adoption of a correct, unmanaged node.
                        AdoptLink(control, candidate, candidate.ExistingContextualParameter, managedLinks, adopted: false);
                        report.Reused++;
                        break;
                    default:
                        report.Skipped++;
                        break;
                }
            }
            catch (Exception exception)
            {
                report.Failed++;
                report.Messages.Add($"{candidate.ControlNickName}: {exception.Message}");
            }
        }

        if (mutated)
        {
            document.UndoServer.PushUndoRecord(record);
        }

        ScheduleRefresh(owner, document, expired);
        return report;
    }

    private static bool InsertContextualParameter(
        GH_Document document,
        GH_UndoRecord record,
        IGH_Param control,
        PrepareUIInputCandidate candidate,
        PrepareUIInputReport report,
        List<IGH_Param> expired,
        List<PrepareUIInputManagedLink> managedLinks,
        float columnLeadingEdge)
    {
        IGH_Param contextual = PrepareUIInputTypeResolver.Emit(candidate.SelectedType);
        if (contextual == null)
        {
            report.Failed++;
            report.Messages.Add($"{candidate.ControlNickName}: '{candidate.SelectedType.DisplayName}' could " +
                $"not be created ({candidate.SelectedType.ProviderName} not installed).");
            return false;
        }

        // Snapshot the recipients and their wire state before anything changes: a GH_WireAction
        // records the sources a parameter has at the moment it is constructed.
        List<IGH_Param> recipients = candidate.DirectRecipients.Where(recipient => recipient != null).ToList();
        var wireActions = recipients.Select(recipient => new GH_WireAction(recipient)).ToList();

        contextual.NickName = candidate.ControlNickName;
        TryApplyAccess(contextual, candidate.Access);
        document.AddObject(contextual, false);
        PlaceContextualParameter(document, contextual, control, columnLeadingEdge, recipients);

        // The new parameter is validated in the document before any existing wire is touched.
        if (document.FindObject(contextual.InstanceGuid, true) == null)
        {
            report.Failed++;
            report.Messages.Add($"{candidate.ControlNickName}: the contextual parameter could not be " +
                "added to the document; no wire was changed.");
            return false;
        }

        RenameControl(record, control, candidate.ControlNickName);
        contextual.AddSource(control);
        foreach (IGH_Param recipient in recipients)
        {
            recipient.ReplaceSource(control, contextual);
            expired.Add(recipient);
        }

        foreach (GH_WireAction wireAction in wireActions)
        {
            record.AddAction(wireAction);
        }

        // Added last so undo removes the object first and the wire actions then restore the
        // recipients' original sources.
        record.AddAction(new GH_AddObjectAction(contextual));

        AdoptLink(control, candidate, contextual, managedLinks, adopted: false, recipients);
        report.Created++;
        return true;
    }

    private static bool RepairContextualParameter(
        GH_UndoRecord record,
        IGH_Param control,
        PrepareUIInputCandidate candidate,
        PrepareUIInputReport report,
        List<IGH_Param> expired,
        List<PrepareUIInputManagedLink> managedLinks)
    {
        IGH_Param contextual = candidate.ExistingContextualParameter;
        if (contextual == null)
        {
            report.Failed++;
            report.Messages.Add($"{candidate.ControlNickName}: the existing contextual parameter could not be resolved.");
            return false;
        }

        List<IGH_Param> recipients = candidate.DirectRecipients.Where(recipient => recipient != null).ToList();
        var wireActions = recipients.Select(recipient => new GH_WireAction(recipient)).ToList();

        bool changed = RenameControl(record, control, candidate.ControlNickName);
        if (contextual.NickName != candidate.ControlNickName)
        {
            record.AddAction(new GH_NickNameAction(contextual));
            contextual.NickName = candidate.ControlNickName;
            changed = true;
        }

        // Access is a safe repair: it changes how the same node reads its data, not the graph.
        if (contextual.Access != candidate.Access && TryApplyAccess(contextual, candidate.Access))
        {
            changed = true;
        }

        foreach (IGH_Param recipient in recipients)
        {
            recipient.ReplaceSource(control, contextual);
            expired.Add(recipient);
            changed = true;
        }

        foreach (GH_WireAction wireAction in wireActions)
        {
            record.AddAction(wireAction);
        }

        if (changed)
        {
            AdoptLink(control, candidate, contextual, managedLinks, adopted: true, recipients);
            report.Repaired++;
        }
        else
        {
            report.Skipped++;
        }

        return changed;
    }

    /// <summary>
    ///     Keeps the local source label and contextual input label identical. The nickname action
    ///     joins the same batch undo record as the graph edits, so one Undo restores both names.
    /// </summary>
    private static bool RenameControl(GH_UndoRecord record, IGH_Param control, string requestedName)
    {
        string name = (requestedName ?? string.Empty).Trim();
        if (control == null || name.Length == 0 || PrepareUIInputTypeResolver.DisplayName(control) == name)
        {
            return false;
        }

        record.AddAction(new GH_NickNameAction(control));
        control.NickName = name;
        return true;
    }

    // ------------------------------------------------------------------
    //  Removal
    // ------------------------------------------------------------------

    /// <summary>
    ///     Reverses the insertion for the selected managed links: every recipient is reconnected to
    ///     the original control first, and only then is the contextual parameter deleted. The
    ///     control itself is never removed, and the registration survives so it can be prepared
    ///     again later.
    /// </summary>
    internal static PrepareUIInputReport ApplyRemoval(
        GH_Component owner,
        GH_Document document,
        IReadOnlyList<PrepareUIInputCandidate> candidates,
        List<PrepareUIInputManagedLink> managedLinks)
    {
        var report = new PrepareUIInputReport();
        if (document == null)
        {
            report.Messages.Add("No active Grasshopper document was found.");
            return report;
        }

        var record = new GH_UndoRecord("Selva Prepare UI Inputs: remove contextual inputs");
        var expired = new List<IGH_Param>();
        var clearedLinks = new List<PrepareUIInputManagedLink>();
        bool mutated = false;

        foreach (PrepareUIInputCandidate candidate in candidates ?? Array.Empty<PrepareUIInputCandidate>())
        {
            if (!candidate.Selected || candidate.ExistingLink == null)
            {
                if (!candidate.Selected)
                {
                    report.Skipped++;
                }

                continue;
            }

            if (candidate.Status == PrepareUIInputStatus.Ambiguous)
            {
                report.Skipped++;
                continue;
            }

            IGH_Param contextual = candidate.ExistingContextualParameter;
            if (contextual == null)
            {
                clearedLinks.Add(candidate.ExistingLink);
                report.Removed++;
                continue;
            }

            if (document.FindObject(candidate.ControlId, true) is not IGH_Param control)
            {
                report.Skipped++;
                continue;
            }

            try
            {
                List<IGH_Param> recipients = contextual.Recipients?.ToList() ?? new List<IGH_Param>();
                var wireActions = recipients.Select(recipient => new GH_WireAction(recipient)).ToList();
                var removeAction = new GH_RemoveObjectAction(contextual);

                foreach (IGH_Param recipient in recipients)
                {
                    recipient.ReplaceSource(contextual, control);
                    expired.Add(recipient);
                }

                // RemoveObject detaches the parameter's own wires; the control keeps every other
                // recipient it had, and is never itself removed.
                document.RemoveObject(contextual, false);

                foreach (GH_WireAction wireAction in wireActions)
                {
                    record.AddAction(wireAction);
                }

                // Added last, and so undone first: a record replays its actions in reverse, and the
                // wire actions can only restore a recipient's source list once the contextual
                // parameter is back in the document.
                record.AddAction(removeAction);

                clearedLinks.Add(candidate.ExistingLink);
                report.Removed++;
                mutated = true;
            }
            catch (Exception exception)
            {
                report.Failed++;
                report.Messages.Add($"{candidate.ControlNickName}: {exception.Message}");
            }
        }

        foreach (PrepareUIInputManagedLink link in clearedLinks)
        {
            managedLinks.Remove(link);
        }

        if (mutated)
        {
            document.UndoServer.PushUndoRecord(record);
        }

        ScheduleRefresh(owner, document, expired);
        return report;
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    /// <summary>
    ///     Records (or refreshes) the relationship between a control and its contextual parameter.
    ///     One entry per control: preparing twice updates the existing row instead of adding a
    ///     second one.
    /// </summary>
    private static void AdoptLink(
        IGH_Param control,
        PrepareUIInputCandidate candidate,
        IGH_Param contextual,
        List<PrepareUIInputManagedLink> managedLinks,
        bool adopted,
        IReadOnlyList<IGH_Param> recipients = null)
    {
        PrepareUIInputManagedLink link = managedLinks.FirstOrDefault(existing => existing.ControlId == candidate.ControlId);
        if (link == null)
        {
            link = new PrepareUIInputManagedLink { ControlId = candidate.ControlId };
            managedLinks.Add(link);
        }

        link.ControlNickName = PrepareUIInputTypeResolver.DisplayName(control);
        link.ControlKind = candidate.Kind.ToString();
        link.Key = string.IsNullOrWhiteSpace(link.Key)
            ? PrepareUIInputInference.BuildKey(link.ControlNickName, candidate.ControlId)
            : link.Key;
        link.ContextualParameterId = contextual.InstanceGuid;
        link.ContextualTypeGuid = contextual.ComponentGuid;
        link.ContextualTypeName = candidate.SelectedType?.DisplayName ?? contextual.Name;
        link.TypeOverridden = candidate.TypeOverridden;
        link.Access = contextual.Access == GH_ParamAccess.list ? "list" : "item";
        link.Adopted = adopted;

        IReadOnlyList<IGH_Param> recorded = recipients ?? (IReadOnlyList<IGH_Param>)(contextual.Recipients?.ToList() ?? new List<IGH_Param>());
        link.RecipientParameterIds = recorded
            .Where(recipient => recipient != null)
            .Select(recipient => recipient.InstanceGuid)
            .Distinct()
            .ToList();
    }

    /// <summary>
    ///     Requests item or list access on a contextual parameter. Some providers override Access
    ///     themselves, so the result is checked rather than assumed, and a refusal is not treated as
    ///     a failure of the insertion.
    /// </summary>
    private static bool TryApplyAccess(IGH_Param contextual, GH_ParamAccess access)
    {
        if (contextual == null || contextual.Access == access)
        {
            return false;
        }

        try
        {
            contextual.Access = access;
            return contextual.Access == access;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    ///     The X every contextual parameter in this batch starts at: the rightmost edge among the
    ///     batch's own controls. Computed once per batch so a row of prepared sliders gets a single
    ///     clean column close beside them, instead of each parameter aligning to its own,
    ///     differently sized control and landing at a different depth than its neighbours.
    /// </summary>
    private static float ResolveColumnLeadingEdge(IReadOnlyList<IGH_Param> controls)
    {
        float leadingEdge = float.MinValue;
        if (controls == null || controls.Count == 0)
        {
            return leadingEdge;
        }

        foreach (IGH_Param control in controls)
        {
            if (control?.Attributes == null)
            {
                continue;
            }

            leadingEdge = Math.Max(leadingEdge, control.Attributes.Bounds.Right);
        }

        return leadingEdge;
    }

    /// <summary>
    ///     Default position: the batch's shared column edge (or this control's own edge, if that
    ///     happens to reach further right), with the control vertically center-aligned to its own
    ///     row. When the control already feeds a downstream recipient, the column is pulled back so
    ///     the new parameter always lands in the gap before that recipient rather than colliding
    ///     with it - a wide processing cluster a few controls down the batch would otherwise sit on
    ///     top of every parameter's first placement attempt and push them all into the same cramped
    ///     stack. A simple downward collision pass covers whatever this clearing still misses.
    ///     Existing objects are never moved.
    /// </summary>
    private static void PlaceContextualParameter(
        GH_Document document,
        IGH_Param contextual,
        IGH_Param control,
        float columnLeadingEdge,
        IReadOnlyList<IGH_Param> recipients)
    {
        if (contextual.Attributes == null)
        {
            contextual.CreateAttributes();
        }

        if (contextual.Attributes == null || control?.Attributes == null)
        {
            return;
        }

        RectangleF controlBounds = control.Attributes.Bounds;
        contextual.Attributes.ExpireLayout();
        contextual.Attributes.PerformLayout();
        RectangleF contextualBounds = contextual.Attributes.Bounds;
        PointF initialPivot = contextual.Attributes.Pivot;
        float pivotOffsetX = initialPivot.X - contextualBounds.Left;
        float pivotOffsetY = initialPivot.Y - contextualBounds.Top;
        float leadingEdge = Math.Max(columnLeadingEdge, controlBounds.Right);
        float minTargetX = controlBounds.Right + InsertionGap + pivotOffsetX;
        float targetX = Math.Max(minTargetX, leadingEdge + InsertionGap + pivotOffsetX);

        float recipientLeft = (recipients ?? Array.Empty<IGH_Param>())
            .Where(recipient => recipient?.Attributes != null)
            .Select(recipient => recipient.Attributes.Bounds.Left)
            .DefaultIfEmpty(float.MaxValue)
            .Min();
        if (recipientLeft < float.MaxValue)
        {
            float maxTargetX = recipientLeft - InsertionGap - contextualBounds.Width + pivotOffsetX;
            targetX = Math.Min(targetX, Math.Max(minTargetX, maxTargetX));
        }

        float targetTop = controlBounds.Top + ((controlBounds.Height - contextualBounds.Height) * 0.5f);
        float targetY = targetTop + pivotOffsetY;

        for (int attempt = 0; attempt < CollisionAttempts; attempt++)
        {
            contextual.Attributes.Pivot = new PointF(targetX, targetY);
            contextual.Attributes.ExpireLayout();
            contextual.Attributes.PerformLayout();
            if (!Overlaps(document, contextual))
            {
                return;
            }

            targetY += CollisionStep;
        }
    }

    /// <summary>
    ///     True when another real object already occupies this space. Groups and scribbles are
    ///     excluded: their bounds are a background label that can span the whole panel, so treating
    ///     them as solid would push every insertion to the bottom of whatever panel it belongs to.
    /// </summary>
    private static bool Overlaps(GH_Document document, IGH_Param contextual)
    {
        RectangleF bounds = RectangleF.Inflate(contextual.Attributes.Bounds, 4f, 4f);
        return document.Objects.Any(other => other != null &&
            other.InstanceGuid != contextual.InstanceGuid &&
            other.Attributes != null &&
            other is not GH_Group &&
            other is not GH_Scribble &&
            other.Attributes.Bounds.IntersectsWith(bounds));
    }

    /// <summary>One scheduled solution for the whole batch, never one per wire change.</summary>
    private static void ScheduleRefresh(GH_Component owner, GH_Document document, IReadOnlyList<IGH_Param> expired)
    {
        foreach (IGH_Param parameter in expired.Distinct())
        {
            parameter?.ExpireSolution(false);
        }

        owner?.ExpireSolution(false);
        document.ScheduleSolution(10, scheduled => scheduled.NewSolution(false));
        Instances.RedrawCanvas();
    }
}
