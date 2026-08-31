using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Canvas controls Prepare UI Inputs can register. Geometry, files, colors, and other
///     producers are out of scope until a UI Builder workflow needs them.
/// </summary>
internal enum PrepareUIInputControlKind
{
    Unknown,
    FloatSlider,
    IntegerSlider,
    ValueList,
    BooleanToggle,
    Panel,
}

/// <summary>
///     The shape of a control's current values. A Panel is text but very often holds a number, so
///     the shape of the data, not the object type, drives its recommendation.
/// </summary>
public enum PrepareUIInputDataShape
{
    Unknown,
    Integer,
    Number,
    Boolean,
    Text,
}

/// <summary>
///     A candidate's classification against the live graph. Only Ready and Repairable are
///     actionable; everything else is reported and left untouched.
/// </summary>
internal enum PrepareUIInputStatus
{
    Ready,
    AlreadyPrepared,
    Repairable,
    Replaceable,
    Ambiguous,
    MissingDependency,
    Unused,
    ControlMissing,
}

/// <summary>
///     One entry of the control-to-contextual-parameter mapping table. <see cref="TypeGuid" /> is
///     the contextual parameter's component GUID as it appears in a saved definition; it is
///     resolved through Grasshopper's component server at run time by
///     <c>PrepareUIInputTypeResolver</c>, never assumed present.
/// </summary>
internal sealed class PrepareUIInputContextualType
{
    internal PrepareUIInputContextualType(Guid typeGuid, string displayName, string providerName)
    {
        TypeGuid = typeGuid;
        DisplayName = displayName;
        ProviderName = providerName;
    }

    internal Guid TypeGuid { get; }

    /// <summary>Name as it appears on the Grasshopper ribbon, e.g. "Get Number".</summary>
    internal string DisplayName { get; }

    /// <summary>Plug-in that must be installed for this type to resolve, for diagnostics.</summary>
    internal string ProviderName { get; }

    public override string ToString()
    {
        return DisplayName;
    }
}

/// <summary>
///     One selectable contextual type for a candidate, with the reason it is offered.
///     <see cref="Available" /> and <see cref="Recommended" /> are set by the caller after this is
///     built: availability requires the component server, which this pure type never touches.
/// </summary>
internal sealed class PrepareUIInputTypeOption
{
    internal PrepareUIInputTypeOption(PrepareUIInputContextualType type, string note)
    {
        Type = type;
        Note = note ?? string.Empty;
    }

    internal PrepareUIInputContextualType Type { get; }

    /// <summary>What choosing this type means for the value the web control sends.</summary>
    internal string Note { get; }

    internal bool Recommended { get; set; }

    internal bool Available { get; set; } = true;

    /// <summary>Label shown in the drop-down; also how a chosen row is matched back.</summary>
    internal string Label
    {
        get
        {
            string detected = Recommended ? "  (detected)" : string.Empty;
            string missing = Available ? string.Empty : "  - not installed";
            return Type.DisplayName + detected + missing;
        }
    }

    public override string ToString()
    {
        return Label;
    }
}

/// <summary>
///     What inspecting a control's current output found: how many values it carries and what they
///     look like. Built from the parameter's volatile data, so it reflects the last solution
///     rather than a guess from the object type.
/// </summary>
internal sealed class PrepareUIInputSourceProfile
{
    internal PrepareUIInputDataShape Shape { get; set; } = PrepareUIInputDataShape.Unknown;

    internal int ValueCount { get; set; }

    internal string Sample { get; set; } = string.Empty;

    internal bool IsList => ValueCount > 1;

    internal string Describe()
    {
        string shape = ShapeLabel(Shape);
        string count = ValueCount == 0 ? "no values" : ValueCount == 1 ? "1 value" : $"{ValueCount} values";
        if (string.IsNullOrEmpty(Sample))
        {
            return $"{count}, {shape}";
        }

        return $"{count}, {shape} (e.g. {Sample})";
    }

    private static string ShapeLabel(PrepareUIInputDataShape shape)
    {
        switch (shape)
        {
            case PrepareUIInputDataShape.Integer:
                return "whole numbers";
            case PrepareUIInputDataShape.Number:
                return "decimal numbers";
            case PrepareUIInputDataShape.Boolean:
                return "true/false";
            case PrepareUIInputDataShape.Text:
                return "text";
            default:
                return "no data yet";
        }
    }
}

/// <summary>
///     The persisted relationship between an original control and the contextual parameter this
///     component created (or explicitly adopted) for it. Reversible removal needs every field here
///     so it can verify the graph still matches what was recorded before it touches anything.
/// </summary>
internal sealed class PrepareUIInputManagedLink
{
    public Guid ControlId { get; set; }

    public string ControlNickName { get; set; } = string.Empty;

    public string ControlKind { get; set; } = PrepareUIInputControlKind.Unknown.ToString();

    /// <summary>
    ///     Stable key for the interface item, kept alongside the GUID so a later manifest export can
    ///     survive the author replacing the Grasshopper object.
    /// </summary>
    public string Key { get; set; } = string.Empty;

    public Guid ContextualParameterId { get; set; }

    public Guid ContextualTypeGuid { get; set; }

    public string ContextualTypeName { get; set; } = string.Empty;

    /// <summary>
    ///     True when the author overrode the inferred type. Recorded so a later re-run does not
    ///     quietly reset a deliberate choice.
    /// </summary>
    public bool TypeOverridden { get; set; }

    /// <summary>"item" or "list": the access the contextual parameter was created with.</summary>
    public string Access { get; set; } = "item";

    /// <summary>Recipient input parameters the control fed before insertion.</summary>
    public List<Guid> RecipientParameterIds { get; set; } = new();

    /// <summary>
    ///     True when the contextual parameter already existed and this component took ownership of
    ///     it rather than creating it.
    /// </summary>
    public bool Adopted { get; set; }

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>The outcome of a pure classification decision, before any document is touched.</summary>
internal readonly struct PrepareUIInputDecision
{
    internal PrepareUIInputDecision(PrepareUIInputStatus status, string note, bool selected)
    {
        Status = status;
        Note = note;
        Selected = selected;
    }

    internal PrepareUIInputStatus Status { get; }

    internal string Note { get; }

    internal bool Selected { get; }
}

/// <summary>
///     The control-to-contextual-type registry and the classification math behind it: shape
///     detection, option ordering, recommendation, and the status decision. Deliberately free of
///     any Grasshopper or Rhino reference so it can be linked directly into Selva.Tests (see
///     Selva.Tests.csproj) without dragging Grasshopper/RhinoCommon into the net8 test host.
///     Anything that touches a live document object belongs in PrepareUIInputTypeResolver instead.
/// </summary>
internal static class PrepareUIInputInference
{
    private const int SampleLength = 24;
    private const int MaxNickNameLength = 128;
    private const int KeyGuidFragmentLength = 8;

    /// <summary>External Hops / Rhino.Compute contextual parameter.</summary>
    internal static readonly PrepareUIInputContextualType GetNumber = new(
        new Guid("7b36b876-9451-46f5-8220-a200d969cc66"), "Get Number", "Hops / Rhino.Compute");

    /// <summary>External Hops / Rhino.Compute contextual parameter.</summary>
    internal static readonly PrepareUIInputContextualType GetInteger = new(
        new Guid("b228887e-0852-4d9f-bd46-2591646e0d7c"), "Get Integer", "Hops / Rhino.Compute");

    /// <summary>External Hops / Rhino.Compute contextual parameter.</summary>
    internal static readonly PrepareUIInputContextualType GetBoolean = new(
        new Guid("51ef601d-f86e-4ee4-bcf2-3d459d3e95e9"), "Get Boolean", "Hops / Rhino.Compute");

    /// <summary>External Hops / Rhino.Compute contextual parameter.</summary>
    internal static readonly PrepareUIInputContextualType GetString = new(
        new Guid("fed87bdd-8327-49cd-949c-09d70f3c345c"), "Get String", "Hops / Rhino.Compute");

    /// <summary>Selva's own contextual parameter (GetValueListParameter).</summary>
    internal static readonly PrepareUIInputContextualType GetValueList = new(
        new Guid("0CC81276-5DB7-4306-9968-086524EC0C6E"), "Get Value List", "Selva");

    private static readonly PrepareUIInputContextualType[] AllTypes =
    {
        GetNumber, GetInteger, GetBoolean, GetString, GetValueList,
    };

    internal static PrepareUIInputContextualType FromGuid(Guid typeGuid)
    {
        return AllTypes.FirstOrDefault(type => type.TypeGuid == typeGuid);
    }

    internal static string Describe(PrepareUIInputControlKind kind)
    {
        switch (kind)
        {
            case PrepareUIInputControlKind.FloatSlider:
                return "Number Slider (floating point)";
            case PrepareUIInputControlKind.IntegerSlider:
                return "Number Slider (integer/even/odd)";
            case PrepareUIInputControlKind.ValueList:
                return "Value List";
            case PrepareUIInputControlKind.BooleanToggle:
                return "Boolean Toggle";
            case PrepareUIInputControlKind.Panel:
                return "Panel";
            default:
                return "Unsupported";
        }
    }

    /// <summary>
    ///     Reads whole numbers, decimals, booleans, or text from a list of raw string values. Pure
    ///     string parsing, no Rhino dependency, so a Panel's own text or a control's volatile data
    ///     can both be classified through the same path.
    /// </summary>
    internal static PrepareUIInputDataShape DetectShape(IReadOnlyList<string> values)
    {
        if (values == null || values.Count == 0)
        {
            return PrepareUIInputDataShape.Unknown;
        }

        bool allIntegers = true;
        bool allNumbers = true;
        bool allBooleans = true;
        foreach (string value in values)
        {
            string trimmed = (value ?? string.Empty).Trim();
            if (!bool.TryParse(trimmed, out _))
            {
                allBooleans = false;
            }

            if (!double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
            {
                allNumbers = false;
                allIntegers = false;
                continue;
            }

            if (Math.Abs(number - Math.Round(number)) > 1e-9)
            {
                allIntegers = false;
            }
        }

        if (allBooleans)
        {
            return PrepareUIInputDataShape.Boolean;
        }

        if (allIntegers && allNumbers)
        {
            return PrepareUIInputDataShape.Integer;
        }

        if (allNumbers)
        {
            return PrepareUIInputDataShape.Number;
        }

        return PrepareUIInputDataShape.Text;
    }

    internal static string Truncate(string value, int length)
    {
        string cleaned = (value ?? string.Empty).Replace("\r", " ").Replace("\n", " ").Trim();
        if (cleaned.Length <= length)
        {
            return cleaned;
        }

        return cleaned.Substring(0, length - 3) + "...";
    }

    internal static string TruncateSample(string value)
    {
        return Truncate(value, SampleLength);
    }

    /// <summary>
    ///     The inferred best fit. Sliders and toggles are decided by the object itself; Panels and
    ///     Value Lists are decided by their current content, because both can legitimately carry
    ///     numbers, booleans, or text. <paramref name="valueListAvailable" /> is supplied by the
    ///     caller rather than looked up here, because availability needs the component server.
    /// </summary>
    internal static PrepareUIInputContextualType Recommend(
        PrepareUIInputControlKind kind,
        PrepareUIInputDataShape shape,
        bool valueListAvailable)
    {
        switch (kind)
        {
            case PrepareUIInputControlKind.FloatSlider:
                return GetNumber;
            case PrepareUIInputControlKind.IntegerSlider:
                return GetInteger;
            case PrepareUIInputControlKind.BooleanToggle:
                return GetBoolean;
            case PrepareUIInputControlKind.ValueList:
                return valueListAvailable ? GetValueList : FromShape(shape);
            case PrepareUIInputControlKind.Panel:
                return FromShape(shape);
            default:
                return null;
        }
    }

    private static PrepareUIInputContextualType FromShape(PrepareUIInputDataShape shape)
    {
        switch (shape)
        {
            case PrepareUIInputDataShape.Integer:
                return GetInteger;
            case PrepareUIInputDataShape.Number:
                return GetNumber;
            case PrepareUIInputDataShape.Boolean:
                return GetBoolean;
            default:
                return GetString;
        }
    }

    /// <summary>
    ///     The compatible contextual types for a control, most appropriate first, each with the
    ///     consequence of choosing it and marked with its availability. Unavailable types stay in
    ///     the list rather than being hidden, so "Get Value List - not installed" explains why a
    ///     Value List fell back to text instead of just looking arbitrary.
    /// </summary>
    internal static List<PrepareUIInputTypeOption> BuildOptions(
        PrepareUIInputControlKind kind,
        PrepareUIInputDataShape shape,
        ISet<Guid> availableTypeGuids)
    {
        PrepareUIInputContextualType recommended = Recommend(
            kind, shape, availableTypeGuids.Contains(GetValueList.TypeGuid));
        var ordered = new List<PrepareUIInputContextualType>();
        var notes = new Dictionary<Guid, string>();

        switch (kind)
        {
            case PrepareUIInputControlKind.FloatSlider:
            case PrepareUIInputControlKind.IntegerSlider:
                ordered.Add(GetNumber);
                ordered.Add(GetInteger);
                ordered.Add(GetString);
                notes[GetNumber.TypeGuid] = kind == PrepareUIInputControlKind.IntegerSlider
                    ? "a continuous web control; the slider's whole-number step is not enforced remotely"
                    : "a continuous web control matching the slider";
                notes[GetInteger.TypeGuid] = kind == PrepareUIInputControlKind.FloatSlider
                    ? "a stepped web control; decimal values sent from the web are rounded"
                    : "a stepped web control matching the slider";
                notes[GetString.TypeGuid] = "a free text box; downstream inputs must accept text or coerce it";
                break;

            case PrepareUIInputControlKind.BooleanToggle:
                ordered.Add(GetBoolean);
                ordered.Add(GetInteger);
                ordered.Add(GetString);
                notes[GetBoolean.TypeGuid] = "a checkbox matching the toggle";
                notes[GetInteger.TypeGuid] = "exposes the toggle as 0 or 1";
                notes[GetString.TypeGuid] = "exposes the toggle as the text true or false";
                break;

            case PrepareUIInputControlKind.ValueList:
                ordered.Add(GetValueList);
                ordered.Add(GetString);
                ordered.Add(GetInteger);
                ordered.Add(GetNumber);
                notes[GetValueList.TypeGuid] = "a real drop-down carrying the list's own options and selection";
                notes[GetString.TypeGuid] = "sends the selected value as text; the option list is not published";
                notes[GetInteger.TypeGuid] =
                    "sends the selected value as a whole number; the option list is not published";
                notes[GetNumber.TypeGuid] = "sends the selected value as a number; the option list is not published";
                break;

            case PrepareUIInputControlKind.Panel:
                // Get Value List is intentionally excluded: Selva's parameter reads option metadata
                // from an actual GH_ValueList, which a Panel cannot provide.
                ordered.Add(GetString);
                ordered.Add(GetNumber);
                ordered.Add(GetInteger);
                ordered.Add(GetBoolean);
                notes[GetString.TypeGuid] = "a text box, matching the panel's own type";
                notes[GetNumber.TypeGuid] = "a numeric control; the panel's content must always parse as a number";
                notes[GetInteger.TypeGuid] =
                    "a stepped numeric control; the content must always be whole numbers";
                notes[GetBoolean.TypeGuid] = "a checkbox; the content must always be true or false";
                break;

            default:
                return new List<PrepareUIInputTypeOption>();
        }

        if (recommended != null && ordered.Remove(recommended))
        {
            ordered.Insert(0, recommended);
        }

        return ordered
            .Select(type => new PrepareUIInputTypeOption(type, notes.TryGetValue(type.TypeGuid, out string note) ? note : string.Empty)
            {
                Recommended = type == recommended,
                Available = availableTypeGuids.Contains(type.TypeGuid),
            })
            .ToList();
    }

    /// <summary>
    ///     Decides a candidate's status from its currently selected type and the live wiring,
    ///     expressed entirely in primitives so it can be unit tested without a Grasshopper document.
    ///     Mirrors the branches PrepareUIInputGraphService.ClassifyCandidate gathers from the live
    ///     graph: no compatible type, a disconnected control, a missing provider, more than one
    ///     existing contextual reader, a type mismatch against an existing reader, a repairable
    ///     drift (name/access/stray wires), an already-correct reader, or a fresh insertion.
    /// </summary>
    internal static PrepareUIInputDecision DecideStatus(
        PrepareUIInputContextualType selectedType,
        bool selectedTypeAvailable,
        string controlKindDescription,
        int directRecipientCount,
        int contextualRecipientCount,
        string controlNickName,
        string accessName,
        bool typeOverridden,
        string recommendedDisplayName,
        Guid? existingContextualTypeGuid,
        string existingContextualName,
        bool nickNameDrifted,
        bool controlNameChanged,
        bool accessChanged,
        bool alreadyManaged)
    {
        if (selectedType == null)
        {
            return new PrepareUIInputDecision(
                PrepareUIInputStatus.Ambiguous,
                $"{controlKindDescription} has no compatible contextual parameter.",
                false);
        }

        if (directRecipientCount == 0 && contextualRecipientCount == 0)
        {
            if (!selectedTypeAvailable)
            {
                return new PrepareUIInputDecision(
                    PrepareUIInputStatus.MissingDependency,
                    MissingDependencyNote(selectedType),
                    false);
            }

            return new PrepareUIInputDecision(
                PrepareUIInputStatus.Ready,
                $"Create a standalone '{selectedType.DisplayName}' named '{controlNickName}' beside " +
                    "this control. It will carry the current local value and can be connected to a " +
                    "downstream input later.",
                true);
        }

        if (!selectedTypeAvailable)
        {
            return new PrepareUIInputDecision(
                PrepareUIInputStatus.MissingDependency,
                MissingDependencyNote(selectedType),
                false);
        }

        if (contextualRecipientCount > 1)
        {
            return new PrepareUIInputDecision(
                PrepareUIInputStatus.Ambiguous,
                $"{contextualRecipientCount} contextual parameters already read this control. Reduce " +
                    "them to one before preparing it.",
                false);
        }

        if (contextualRecipientCount == 1)
        {
            if (existingContextualTypeGuid != selectedType.TypeGuid)
            {
                // The node itself cannot change type in place, but the relationship can still be
                // updated: PrepareUIInputGraphService.ReplaceContextualParameter removes the
                // existing node and places a new one of the chosen type, reconnecting whatever the
                // old node fed. Selected defaults to true, same as Repairable, since this only
                // happens after the author deliberately picked a different type (or the existing
                // node's type was not recognized) and Update Get inputs is how they act on it.
                return new PrepareUIInputDecision(
                    PrepareUIInputStatus.Replaceable,
                    $"An existing '{existingContextualName}' reads this control. Updating will remove " +
                        $"it and place a new '{selectedType.DisplayName}' in its place, reconnecting its " +
                        "downstream recipients.",
                    true);
            }

            if (directRecipientCount > 0 || nickNameDrifted || controlNameChanged || accessChanged)
            {
                return new PrepareUIInputDecision(
                    PrepareUIInputStatus.Repairable,
                    BuildRepairNote(
                        directRecipientCount, nickNameDrifted, controlNameChanged, accessChanged, accessName,
                        controlNickName),
                    true);
            }

            return new PrepareUIInputDecision(
                PrepareUIInputStatus.AlreadyPrepared,
                alreadyManaged
                    ? "Already prepared and managed by this component."
                    : "A compatible contextual parameter is already in place. Preparing again adopts " +
                        "it without creating a second one.",
                !alreadyManaged);
        }

        string overrideSuffix = typeOverridden
            ? $" Overrides the detected '{recommendedDisplayName}'."
            : string.Empty;
        return new PrepareUIInputDecision(
            PrepareUIInputStatus.Ready,
            $"Insert '{selectedType.DisplayName}' ({accessName.ToLowerInvariant()} access) nicknamed " +
                $"'{controlNickName}' in front of {directRecipientCount} recipient input(s).{overrideSuffix}",
            true);
    }

    private static string MissingDependencyNote(PrepareUIInputContextualType type)
    {
        return $"'{type.DisplayName}' is not installed ({type.ProviderName}). No substitute is " +
            "inserted - pick another type or install the provider.";
    }

    private static string BuildRepairNote(
        int strayRecipients,
        bool nickNameDrifted,
        bool controlNameChanged,
        bool accessChanged,
        string requestedAccess,
        string expectedNickName)
    {
        var parts = new List<string>();
        if (strayRecipients > 0)
        {
            parts.Add($"{strayRecipients} recipient input(s) still read the control directly and " +
                "would be routed through the existing contextual parameter");
        }

        if (nickNameDrifted)
        {
            parts.Add($"the contextual parameter would be renamed to '{expectedNickName}'");
        }

        if (controlNameChanged)
        {
            parts.Add($"the source control would be renamed to '{expectedNickName}'");
        }

        if (accessChanged)
        {
            parts.Add($"the contextual parameter access would change to {requestedAccess}");
        }

        string first = char.ToUpperInvariant(parts[0][0]) + parts[0].Substring(1);
        string rest = parts.Count > 1 ? "; " + string.Join("; ", parts.Skip(1)) : string.Empty;
        return first + rest + ".";
    }

    /// <summary>
    ///     A stable, lower-case interface key derived from the control nickname, disambiguated by a
    ///     GUID fragment so two identically nicknamed controls never collide.
    /// </summary>
    internal static string BuildKey(string nickName, Guid controlId)
    {
        char[] cleanedChars = (nickName ?? string.Empty)
            .Select(character => char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : '_')
            .ToArray();
        string cleaned = new string(cleanedChars).Trim('_');
        while (cleaned.Contains("__"))
        {
            cleaned = cleaned.Replace("__", "_");
        }

        if (string.IsNullOrEmpty(cleaned))
        {
            cleaned = "input";
        }

        string fragment = controlId.ToString("N").Substring(0, KeyGuidFragmentLength);
        return $"{cleaned}_{fragment}";
    }

    /// <summary>Cleans and length-caps a shared name typed in the preview dialog.</summary>
    internal static string CleanNickName(string requested, string fallback)
    {
        string cleaned = (requested ?? string.Empty).Replace("\r", " ").Replace("\n", " ").Trim();
        if (cleaned.Length == 0)
        {
            cleaned = fallback ?? string.Empty;
        }

        if (cleaned.Length > MaxNickNameLength)
        {
            cleaned = cleaned.Substring(0, MaxNickNameLength).Trim();
        }

        return cleaned;
    }
}
