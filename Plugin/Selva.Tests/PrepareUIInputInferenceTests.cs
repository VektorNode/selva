using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.Tests;

/// <summary>
///     Tests for the Rhino-free classification math behind Prepare UI Inputs: shape detection,
///     option ordering/availability, the status decision table, and key/name normalization. None
///     of this touches Grasshopper, so it runs directly in the net8 test host (see
///     Selva.Tests.csproj's linked-file comment for PrepareUIInputInference.cs).
/// </summary>
public class PrepareUIInputInferenceTests
{
    private static readonly HashSet<Guid> AllAvailable = new()
    {
        PrepareUIInputInference.GetNumber.TypeGuid,
        PrepareUIInputInference.GetInteger.TypeGuid,
        PrepareUIInputInference.GetBoolean.TypeGuid,
        PrepareUIInputInference.GetString.TypeGuid,
        PrepareUIInputInference.GetValueList.TypeGuid,
    };

    private static readonly HashSet<Guid> NoneAvailable = new();

    // -------------------------------------------------------------------------
    // Slider classification
    // -------------------------------------------------------------------------

    [Fact]
    public void Recommend_FloatSlider_IsGetNumber()
    {
        var result = PrepareUIInputInference.Recommend(
            PrepareUIInputControlKind.FloatSlider, PrepareUIInputDataShape.Unknown, valueListAvailable: true);

        Assert.Equal(PrepareUIInputInference.GetNumber, result);
    }

    [Fact]
    public void Recommend_IntegerSlider_IsGetInteger()
    {
        var result = PrepareUIInputInference.Recommend(
            PrepareUIInputControlKind.IntegerSlider, PrepareUIInputDataShape.Unknown, valueListAvailable: true);

        Assert.Equal(PrepareUIInputInference.GetInteger, result);
    }

    [Fact]
    public void BuildOptions_IntegerSlider_OffersNumberIntegerAndString_NeverValueList()
    {
        var options = PrepareUIInputInference.BuildOptions(
            PrepareUIInputControlKind.IntegerSlider, PrepareUIInputDataShape.Unknown, AllAvailable);

        Assert.Equal(3, options.Count);
        Assert.DoesNotContain(options, option => option.Type == PrepareUIInputInference.GetValueList);
        Assert.Equal(PrepareUIInputInference.GetInteger, options[0].Type);
        Assert.True(options[0].Recommended);
    }

    // -------------------------------------------------------------------------
    // Boolean Toggle classification
    // -------------------------------------------------------------------------

    [Fact]
    public void Recommend_BooleanToggle_IsGetBoolean()
    {
        var result = PrepareUIInputInference.Recommend(
            PrepareUIInputControlKind.BooleanToggle, PrepareUIInputDataShape.Unknown, valueListAvailable: true);

        Assert.Equal(PrepareUIInputInference.GetBoolean, result);
    }

    [Fact]
    public void BuildOptions_BooleanToggle_NeverOffersValueList()
    {
        var options = PrepareUIInputInference.BuildOptions(
            PrepareUIInputControlKind.BooleanToggle, PrepareUIInputDataShape.Unknown, AllAvailable);

        Assert.DoesNotContain(options, option => option.Type == PrepareUIInputInference.GetValueList);
    }

    // -------------------------------------------------------------------------
    // Value List classification
    // -------------------------------------------------------------------------

    [Fact]
    public void Recommend_ValueList_PrefersGetValueList_WhenAvailable()
    {
        var result = PrepareUIInputInference.Recommend(
            PrepareUIInputControlKind.ValueList, PrepareUIInputDataShape.Text, valueListAvailable: true);

        Assert.Equal(PrepareUIInputInference.GetValueList, result);
    }

    [Fact]
    public void Recommend_ValueList_FallsBackToShape_WhenGetValueListUnavailable()
    {
        var result = PrepareUIInputInference.Recommend(
            PrepareUIInputControlKind.ValueList, PrepareUIInputDataShape.Integer, valueListAvailable: false);

        Assert.Equal(PrepareUIInputInference.GetInteger, result);
    }

    [Fact]
    public void BuildOptions_ValueList_MarksGetValueListUnavailable_WhenSelvaTypeMissing()
    {
        var options = PrepareUIInputInference.BuildOptions(
            PrepareUIInputControlKind.ValueList, PrepareUIInputDataShape.Text, NoneAvailable);

        var valueListOption = options.Single(option => option.Type == PrepareUIInputInference.GetValueList);
        Assert.False(valueListOption.Available);
        Assert.Contains("not installed", valueListOption.Label);
    }

    // -------------------------------------------------------------------------
    // Panel inference — data shape drives the recommendation, never Get Value List
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData(new[] { "1", "2", "3" }, PrepareUIInputDataShape.Integer)]
    [InlineData(new[] { "1.5" }, PrepareUIInputDataShape.Number)]
    [InlineData(new[] { "true", "false" }, PrepareUIInputDataShape.Boolean)]
    [InlineData(new[] { "hello" }, PrepareUIInputDataShape.Text)]
    public void DetectShape_ClassifiesRawValues(string[] values, PrepareUIInputDataShape expected)
    {
        var shape = PrepareUIInputInference.DetectShape(values);

        Assert.Equal(expected, shape);
    }

    [Fact]
    public void DetectShape_EmptyValues_IsUnknown()
    {
        var shape = PrepareUIInputInference.DetectShape(Array.Empty<string>());

        Assert.Equal(PrepareUIInputDataShape.Unknown, shape);
    }

    [Fact]
    public void Recommend_Panel_SingleNumericValue_IsGetNumber()
    {
        var shape = PrepareUIInputInference.DetectShape(new[] { "3.14" });
        var result = PrepareUIInputInference.Recommend(PrepareUIInputControlKind.Panel, shape, valueListAvailable: true);

        Assert.Equal(PrepareUIInputInference.GetNumber, result);
    }

    [Fact]
    public void Recommend_Panel_MultipleIntegerValues_IsGetInteger()
    {
        var shape = PrepareUIInputInference.DetectShape(new[] { "1", "2", "3" });
        var result = PrepareUIInputInference.Recommend(PrepareUIInputControlKind.Panel, shape, valueListAvailable: true);

        Assert.Equal(PrepareUIInputInference.GetInteger, result);
    }

    [Theory]
    [InlineData(PrepareUIInputDataShape.Unknown)]
    [InlineData(PrepareUIInputDataShape.Integer)]
    [InlineData(PrepareUIInputDataShape.Number)]
    [InlineData(PrepareUIInputDataShape.Boolean)]
    [InlineData(PrepareUIInputDataShape.Text)]
    public void BuildOptions_Panel_NeverOffersGetValueList(PrepareUIInputDataShape shape)
    {
        var options = PrepareUIInputInference.BuildOptions(PrepareUIInputControlKind.Panel, shape, AllAvailable);

        Assert.DoesNotContain(options, option => option.Type == PrepareUIInputInference.GetValueList);
    }

    // -------------------------------------------------------------------------
    // Status decision table
    // -------------------------------------------------------------------------

    [Fact]
    public void DecideStatus_NoCompatibleType_IsAmbiguous()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            selectedType: null, selectedTypeAvailable: false, controlKindDescription: "Panel",
            directRecipientCount: 0, contextualRecipientCount: 0, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null, existingContextualTypeGuid: null,
            existingContextualName: string.Empty, nickNameDrifted: false, controlNameChanged: false,
            accessChanged: false, alreadyManaged: false);

        Assert.Equal(PrepareUIInputStatus.Ambiguous, decision.Status);
        Assert.False(decision.Selected);
    }

    [Fact]
    public void DecideStatus_DisconnectedControl_MissingProvider_IsMissingDependency()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetValueList, selectedTypeAvailable: false, controlKindDescription: "Value List",
            directRecipientCount: 0, contextualRecipientCount: 0, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null, existingContextualTypeGuid: null,
            existingContextualName: string.Empty, nickNameDrifted: false, controlNameChanged: false,
            accessChanged: false, alreadyManaged: false);

        Assert.Equal(PrepareUIInputStatus.MissingDependency, decision.Status);
        Assert.False(decision.Selected);
    }

    [Fact]
    public void DecideStatus_DisconnectedControl_AvailableProvider_IsReadyToCreateStandalone()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetNumber, selectedTypeAvailable: true, controlKindDescription: "Number Slider",
            directRecipientCount: 0, contextualRecipientCount: 0, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null, existingContextualTypeGuid: null,
            existingContextualName: string.Empty, nickNameDrifted: false, controlNameChanged: false,
            accessChanged: false, alreadyManaged: false);

        Assert.Equal(PrepareUIInputStatus.Ready, decision.Status);
        Assert.True(decision.Selected);
    }

    [Fact]
    public void DecideStatus_ExistingReaderOfWrongType_IsReplaceable()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetNumber, selectedTypeAvailable: true, controlKindDescription: "Number Slider",
            directRecipientCount: 1, contextualRecipientCount: 1, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null,
            existingContextualTypeGuid: PrepareUIInputInference.GetString.TypeGuid, existingContextualName: "Get String",
            nickNameDrifted: false, controlNameChanged: false, accessChanged: false, alreadyManaged: false);

        // The node itself cannot change type in place, so a type mismatch is something this
        // component can act on (ReplaceContextualParameter), not a dead end - it must stay
        // selectable rather than falling into the same bucket as a genuinely unsafe row.
        Assert.Equal(PrepareUIInputStatus.Replaceable, decision.Status);
        Assert.True(decision.Selected);
        Assert.Contains("Get String", decision.Note);
    }

    [Fact]
    public void DecideStatus_ExistingCorrectReader_NoDrift_IsAlreadyPreparedAndUnselected_WhenManaged()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetNumber, selectedTypeAvailable: true, controlKindDescription: "Number Slider",
            directRecipientCount: 0, contextualRecipientCount: 1, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null,
            existingContextualTypeGuid: PrepareUIInputInference.GetNumber.TypeGuid, existingContextualName: "Get Number",
            nickNameDrifted: false, controlNameChanged: false, accessChanged: false, alreadyManaged: true);

        Assert.Equal(PrepareUIInputStatus.AlreadyPrepared, decision.Status);
        Assert.False(decision.Selected);
    }

    [Fact]
    public void DecideStatus_ExistingCorrectReader_Unmanaged_IsAlreadyPreparedButSelected_ForAdoption()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetNumber, selectedTypeAvailable: true, controlKindDescription: "Number Slider",
            directRecipientCount: 0, contextualRecipientCount: 1, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null,
            existingContextualTypeGuid: PrepareUIInputInference.GetNumber.TypeGuid, existingContextualName: "Get Number",
            nickNameDrifted: false, controlNameChanged: false, accessChanged: false, alreadyManaged: false);

        Assert.Equal(PrepareUIInputStatus.AlreadyPrepared, decision.Status);
        Assert.True(decision.Selected);
    }

    [Theory]
    [InlineData(true, false, false, false)]
    [InlineData(false, true, false, false)]
    [InlineData(false, false, true, false)]
    [InlineData(false, false, false, true)]
    public void DecideStatus_ExistingCorrectReader_WithDrift_IsRepairable(
        bool strayRecipient, bool nickNameDrifted, bool controlNameChanged, bool accessChanged)
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetNumber, selectedTypeAvailable: true, controlKindDescription: "Number Slider",
            directRecipientCount: strayRecipient ? 1 : 0, contextualRecipientCount: 1, controlNickName: "x",
            accessName: "Item", typeOverridden: false, recommendedDisplayName: null,
            existingContextualTypeGuid: PrepareUIInputInference.GetNumber.TypeGuid, existingContextualName: "Get Number",
            nickNameDrifted: nickNameDrifted, controlNameChanged: controlNameChanged, accessChanged: accessChanged,
            alreadyManaged: true);

        Assert.Equal(PrepareUIInputStatus.Repairable, decision.Status);
        Assert.True(decision.Selected);
    }

    [Fact]
    public void DecideStatus_MultipleExistingReaders_IsAmbiguous()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetNumber, selectedTypeAvailable: true, controlKindDescription: "Number Slider",
            directRecipientCount: 0, contextualRecipientCount: 2, controlNickName: "x", accessName: "Item",
            typeOverridden: false, recommendedDisplayName: null, existingContextualTypeGuid: null,
            existingContextualName: string.Empty, nickNameDrifted: false, controlNameChanged: false,
            accessChanged: false, alreadyManaged: false);

        Assert.Equal(PrepareUIInputStatus.Ambiguous, decision.Status);
    }

    [Fact]
    public void DecideStatus_FreshInsertion_MentionsOverride_WhenTypeOverridden()
    {
        var decision = PrepareUIInputInference.DecideStatus(
            PrepareUIInputInference.GetInteger, selectedTypeAvailable: true, controlKindDescription: "Panel",
            directRecipientCount: 1, contextualRecipientCount: 0, controlNickName: "count", accessName: "Item",
            typeOverridden: true, recommendedDisplayName: "Get String", existingContextualTypeGuid: null,
            existingContextualName: string.Empty, nickNameDrifted: false, controlNameChanged: false,
            accessChanged: false, alreadyManaged: false);

        Assert.Equal(PrepareUIInputStatus.Ready, decision.Status);
        Assert.Contains("Overrides the detected 'Get String'", decision.Note);
    }

    // -------------------------------------------------------------------------
    // Key and name normalization
    // -------------------------------------------------------------------------

    [Fact]
    public void BuildKey_CleansPunctuationAndAppendsGuidFragment()
    {
        var id = new Guid("11112222-3333-4444-5555-666677778888");

        var key = PrepareUIInputInference.BuildKey("Panel Width (mm)", id);

        Assert.Equal("panel_width_mm_11112222", key);
    }

    [Fact]
    public void BuildKey_TwoIdenticalNickNames_ProduceDifferentKeys()
    {
        var first = PrepareUIInputInference.BuildKey("Width", Guid.NewGuid());
        var second = PrepareUIInputInference.BuildKey("Width", Guid.NewGuid());

        Assert.NotEqual(first, second);
    }

    [Fact]
    public void BuildKey_EmptyNickName_FallsBackToInput()
    {
        var key = PrepareUIInputInference.BuildKey("   ", Guid.NewGuid());

        Assert.StartsWith("input_", key);
    }

    [Fact]
    public void CleanNickName_EmptyRequest_FallsBackToOriginal()
    {
        var cleaned = PrepareUIInputInference.CleanNickName("   ", "Original Name");

        Assert.Equal("Original Name", cleaned);
    }

    [Fact]
    public void CleanNickName_TooLong_IsTruncated()
    {
        var requested = new string('a', 200);

        var cleaned = PrepareUIInputInference.CleanNickName(requested, "fallback");

        Assert.True(cleaned.Length <= 128);
    }

    // -------------------------------------------------------------------------
    // Serialization round trip
    // -------------------------------------------------------------------------

    [Fact]
    public void ManagedLink_SerializationRoundTrip_PreservesAllFields()
    {
        var link = new PrepareUIInputManagedLink
        {
            ControlId = Guid.NewGuid(),
            ControlNickName = "Width",
            ControlKind = PrepareUIInputControlKind.FloatSlider.ToString(),
            Key = "width_abc123",
            ContextualParameterId = Guid.NewGuid(),
            ContextualTypeGuid = PrepareUIInputInference.GetNumber.TypeGuid,
            ContextualTypeName = "Get Number",
            TypeOverridden = true,
            Access = "list",
            RecipientParameterIds = new List<Guid> { Guid.NewGuid(), Guid.NewGuid() },
            Adopted = true,
        };

        var json = JsonConvert.SerializeObject(link);
        var restored = JsonConvert.DeserializeObject<PrepareUIInputManagedLink>(json);

        Assert.NotNull(restored);
        Assert.Equal(link.ControlId, restored.ControlId);
        Assert.Equal(link.ControlNickName, restored.ControlNickName);
        Assert.Equal(link.ControlKind, restored.ControlKind);
        Assert.Equal(link.Key, restored.Key);
        Assert.Equal(link.ContextualParameterId, restored.ContextualParameterId);
        Assert.Equal(link.ContextualTypeGuid, restored.ContextualTypeGuid);
        Assert.Equal(link.ContextualTypeName, restored.ContextualTypeName);
        Assert.Equal(link.TypeOverridden, restored.TypeOverridden);
        Assert.Equal(link.Access, restored.Access);
        Assert.Equal(link.RecipientParameterIds, restored.RecipientParameterIds);
        Assert.Equal(link.Adopted, restored.Adopted);
    }

    [Fact]
    public void ManagedLink_ListRoundTrip_PreservesOrderAndCount()
    {
        var links = new List<PrepareUIInputManagedLink>
        {
            new() { ControlId = Guid.NewGuid(), ControlNickName = "a" },
            new() { ControlId = Guid.NewGuid(), ControlNickName = "b" },
        };

        var json = JsonConvert.SerializeObject(links);
        var restored = JsonConvert.DeserializeObject<List<PrepareUIInputManagedLink>>(json);

        Assert.NotNull(restored);
        Assert.Equal(2, restored.Count);
        Assert.Equal("a", restored[0].ControlNickName);
        Assert.Equal("b", restored[1].ControlNickName);
    }
}
