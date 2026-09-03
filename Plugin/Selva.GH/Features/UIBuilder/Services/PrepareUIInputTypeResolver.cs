using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Grasshopper;
using Grasshopper.GUI.Base;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.ComputeIO.Components;

namespace Selva.GH.Features.UIBuilder.Services;

// One transient preview row. Built fresh on every preview from the live graph, never
// persisted. The type and access are editable in the dialog, so the status is recomputed
// whenever either changes (see PrepareUIInputGraphService.ClassifyCandidate).
internal sealed class PrepareUIInputCandidate
{
    internal Guid ControlId { get; set; }

    internal string OriginalControlNickName { get; set; } = string.Empty;

    // Shared authoring name requested in the preview. Preparation applies it to both the source
    // control and its contextual parameter, so the Grasshopper and client-interface labels stay
    // synchronized.
    internal string ControlNickName { get; set; } = string.Empty;

    internal bool NameChanged => OriginalControlNickName != ControlNickName;

    internal PrepareUIInputControlKind Kind { get; set; } = PrepareUIInputControlKind.Unknown;

    internal PrepareUIInputSourceProfile Profile { get; set; } = new();

    // Compatible contextual types, recommended one first.
    internal List<PrepareUIInputTypeOption> Options { get; set; } = new();

    internal PrepareUIInputContextualType RecommendedType { get; set; }

    // What will actually be inserted. Editable in the preview dialog.
    internal PrepareUIInputContextualType SelectedType { get; set; }

    internal bool TypeOverridden => SelectedType != null && RecommendedType != null && SelectedType != RecommendedType;

    internal GH_ParamAccess Access { get; set; } = GH_ParamAccess.item;

    internal PrepareUIInputStatus Status { get; set; } = PrepareUIInputStatus.Ambiguous;

    internal List<IGH_Param> DirectRecipients { get; } = new();

    internal List<IGH_Param> ContextualRecipients { get; } = new();

    internal IGH_Param ExistingContextualParameter { get; set; }

    internal PrepareUIInputManagedLink ExistingLink { get; set; }

    internal string Note { get; set; } = string.Empty;

    // Defaults to selected only when acting on this row is safe.
    internal bool Selected { get; set; }

    internal bool IsActionable => Status == PrepareUIInputStatus.Ready || Status == PrepareUIInputStatus.Repairable ||
        Status == PrepareUIInputStatus.Replaceable;

    internal string TypeName => SelectedType?.DisplayName ?? "-";

    internal string AccessName => Access == GH_ParamAccess.list ? "List" : "Item";

    internal int RecipientCount => DirectRecipients.Count;

    internal string StatusText
    {
        get
        {
            switch (Status)
            {
                case PrepareUIInputStatus.Ready:
                    return "Ready";
                case PrepareUIInputStatus.AlreadyPrepared:
                    return "Already prepared";
                case PrepareUIInputStatus.Repairable:
                    return "Repairable";
                case PrepareUIInputStatus.Replaceable:
                    return "Type change pending";
                case PrepareUIInputStatus.Ambiguous:
                    return "Ambiguous";
                case PrepareUIInputStatus.MissingDependency:
                    return "Missing dependency";
                case PrepareUIInputStatus.Unused:
                    return "Unused";
                default:
                    return "Control missing";
            }
        }
    }
}

// Counts and messages for the completion report shown after a preparation or removal.
internal sealed class PrepareUIInputReport
{
    internal int Created { get; set; }

    internal int Reused { get; set; }

    internal int Repaired { get; set; }

    internal int Replaced { get; set; }

    internal int Removed { get; set; }

    internal int Skipped { get; set; }

    internal int Failed { get; set; }

    internal List<string> Messages { get; } = new();

    internal string Summarize(string operation)
    {
        return $"{operation}: {Created} created, {Reused} reused, {Repaired} repaired, " +
            $"{Replaced} replaced, {Removed} removed, {Skipped} skipped, {Failed} failed.";
    }
}

// The live-document half of classification: mapping a Grasshopper object to a
// PrepareUIInputControlKind, reading what a control currently carries, and resolving a
// contextual type against the installed component set. The pure decision math this calls into
// lives in PrepareUIInputInference, which has no Grasshopper dependency and is unit tested
// directly.
internal static class PrepareUIInputTypeResolver
{
    // Availability is asked once per registered control and again per drop-down row; the installed
    // component set does not change while Rhino is running, so the answer is cached.
    private static readonly Dictionary<Guid, bool> AvailabilityCache = new();

    // Classifies a document object as one of the supported control kinds. Number sliders split
    // on their accuracy so an integer-like slider never becomes a floating-point web control.
    internal static PrepareUIInputControlKind Classify(IGH_DocumentObject documentObject)
    {
        switch (documentObject)
        {
            case GH_NumberSlider slider:
                bool isInteger = slider.Slider != null && slider.Slider.Type != GH_SliderAccuracy.Float;
                return isInteger ? PrepareUIInputControlKind.IntegerSlider : PrepareUIInputControlKind.FloatSlider;
            case GH_ValueList:
                return PrepareUIInputControlKind.ValueList;
            case GH_BooleanToggle:
                return PrepareUIInputControlKind.BooleanToggle;
            case GH_Panel:
                return PrepareUIInputControlKind.Panel;
            default:
                return PrepareUIInputControlKind.Unknown;
        }
    }

    // Looks at what the control is currently carrying: how many values, and whether they read
    // as whole numbers, decimals, booleans, or text. Volatile data is the honest source: it is
    // what the recipients actually received on the last solve. A Panel that has never solved
    // falls back to its own text, so a fresh definition still gets a sensible recommendation.
    internal static PrepareUIInputSourceProfile Inspect(IGH_Param control)
    {
        var profile = new PrepareUIInputSourceProfile();
        if (control == null)
        {
            return profile;
        }

        List<string> values = ReadVolatileValues(control);
        if (values.Count == 0 && control is GH_Panel panel)
        {
            values = (panel.UserText ?? string.Empty)
                .Replace("\r\n", "\n")
                .Split('\n')
                .Select(line => line.Trim())
                .Where(line => line.Length > 0)
                .ToList();
        }

        profile.ValueCount = values.Count;
        profile.Sample = values.Count == 0 ? string.Empty : PrepareUIInputInference.TruncateSample(values[0]);
        profile.Shape = PrepareUIInputInference.DetectShape(values);
        return profile;
    }

    private static List<string> ReadVolatileValues(IGH_Param control)
    {
        var values = new List<string>();
        try
        {
            IGH_Structure data = control.VolatileData;
            if (data == null || data.DataCount == 0)
            {
                return values;
            }

            foreach (object item in (IEnumerable)data.AllData(true))
            {
                if (item is IGH_Goo goo && goo.IsValid)
                {
                    values.Add(goo.ToString());
                }
            }
        }
        catch
        {
            // Reading volatile data must never break a preview: an empty profile falls back to
            // the object-type recommendation.
            values.Clear();
        }

        return values;
    }

    // The compatible options for a control given what it currently carries, with availability
    // resolved against the installed component set.
    internal static List<PrepareUIInputTypeOption> Options(PrepareUIInputControlKind kind, PrepareUIInputSourceProfile profile)
    {
        var availableGuids = new HashSet<Guid>(AllTypeGuids().Where(guid => IsAvailable(PrepareUIInputInference.FromGuid(guid))));
        return PrepareUIInputInference.BuildOptions(kind, profile?.Shape ?? PrepareUIInputDataShape.Unknown, availableGuids);
    }

    internal static PrepareUIInputContextualType Recommend(PrepareUIInputControlKind kind, PrepareUIInputSourceProfile profile)
    {
        bool valueListAvailable = IsAvailable(PrepareUIInputInference.GetValueList);
        return PrepareUIInputInference.Recommend(kind, profile?.Shape ?? PrepareUIInputDataShape.Unknown, valueListAvailable);
    }

    private static IEnumerable<Guid> AllTypeGuids()
    {
        yield return PrepareUIInputInference.GetNumber.TypeGuid;
        yield return PrepareUIInputInference.GetInteger.TypeGuid;
        yield return PrepareUIInputInference.GetBoolean.TypeGuid;
        yield return PrepareUIInputInference.GetString.TypeGuid;
        yield return PrepareUIInputInference.GetValueList.TypeGuid;
    }

    // True when the contextual parameter type is installed. Get Value List is Selva's own, so
    // it always resolves; the Hops / Rhino.Compute types resolve by component GUID first, with
    // a ribbon-name fallback in case a future release re-issues one under a new GUID. A proxy
    // that does not emit an IGH_ContextualParameter is treated as absent rather than substituted.
    internal static bool IsAvailable(PrepareUIInputContextualType type)
    {
        if (type == null)
        {
            return false;
        }

        if (AvailabilityCache.TryGetValue(type.TypeGuid, out bool cached))
        {
            return cached;
        }

        bool available = Emit(type) != null;
        AvailabilityCache[type.TypeGuid] = available;
        return available;
    }

    // Creates a fresh, unparented instance of the contextual parameter, or null when the
    // provider is not installed. Callers must add the returned object to a document themselves:
    // nothing here touches the canvas.
    internal static IGH_Param Emit(PrepareUIInputContextualType type)
    {
        if (type == null)
        {
            return null;
        }

        if (type.TypeGuid == PrepareUIInputInference.GetValueList.TypeGuid)
        {
            // Referenced directly rather than through the component server: it lives in the same
            // assembly, so there's nothing to resolve.
            return new GetValueListParameter();
        }

        IGH_Param byGuid = Verify(Instances.ComponentServer?.EmitObject(type.TypeGuid));
        if (byGuid != null)
        {
            return byGuid;
        }

        IGH_ObjectProxy proxy = Instances.ComponentServer?.ObjectProxies?
            .FirstOrDefault(candidate => candidate?.Desc != null &&
                string.Equals(candidate.Desc.Name, type.DisplayName, StringComparison.OrdinalIgnoreCase));
        if (proxy == null)
        {
            return null;
        }

        return Verify(Instances.ComponentServer.EmitObject(proxy.Guid));
    }

    // A contextual parameter is only usable here if it is both an IGH_Param (so it can carry
    // wires) and an IGH_ContextualParameter (so schema discovery finds it). An object that
    // satisfies only one of the two is discarded, never wired in.
    private static IGH_Param Verify(IGH_DocumentObject emitted)
    {
        if (emitted is IGH_Param parameter && emitted is IGH_ContextualParameter)
        {
            return parameter;
        }

        return null;
    }

    internal static string DisplayName(IGH_DocumentObject documentObject)
    {
        if (documentObject == null)
        {
            return string.Empty;
        }

        return string.IsNullOrWhiteSpace(documentObject.NickName) ? documentObject.Name : documentObject.NickName;
    }
}
