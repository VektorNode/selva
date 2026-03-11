using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;

namespace SheepMetal.PluginGrasshopper.Upgraders;

/// <summary>
///     Helper class to simplify Grasshopper component upgrades with automatic data migration
/// </summary>
public class GH_ComponentUpgradeHelper
{
    private readonly Dictionary<int, int> _inputMappings;
    private readonly IGH_Component _oldComponent;
    private readonly Dictionary<int, int> _outputMappings;
    private readonly Guid UpgradeTo;

    public GH_ComponentUpgradeHelper(IGH_Component oldComponent, Guid UpgradeTo)
    {
        _oldComponent = oldComponent;
        this.UpgradeTo = UpgradeTo;
        _inputMappings = new Dictionary<int, int>();
        _outputMappings = new Dictionary<int, int>();
    }

    /// <summary>
    ///     Map an old input index to a new input index
    /// </summary>
    /// <param name="oldIndex">Old parameter index</param>
    /// <param name="newIndex">New parameter index</param>
    public GH_ComponentUpgradeHelper MapInput(int oldIndex, int newIndex)
    {
        _inputMappings[oldIndex] = newIndex;
        return this;
    }

    /// <summary>
    ///     Map an old output index to a new output index
    /// </summary>
    public GH_ComponentUpgradeHelper MapOutput(int oldIndex, int newIndex)
    {
        _outputMappings[oldIndex] = newIndex;
        return this;
    }

    public GH_ComponentUpgradeHelper MapAllOuputs()
    {
        var oldOutputs = _oldComponent.Params.Output;
        for (var i = 0; i < oldOutputs.Count; i++) _outputMappings[i] = i;

        return this;
    }

    /// <summary>
    ///     Execute the migration - reconnects inputs/outputs and ALWAYS internalizes data when no sources
    /// </summary>
    public IGH_Component Execute()
    {
        var oldInputs = _oldComponent.Params.Input;

        var sourceMappings = new Dictionary<(IGH_Param oldParam, int newParamIndex), IGH_Param[]>();

        foreach (var mapping in _inputMappings)
        {
            var oldIndex = mapping.Key;
            var newIndex = mapping.Value;

            var oldParam = oldInputs[oldIndex];

            var sources = oldParam.Sources.ToArray();
            sourceMappings[(oldParam, newIndex)] = sources;
        }

        var oldOutputs = _oldComponent.Params.Output;

        // First, collect all recipients
        var recipientMappings = new Dictionary<(IGH_Param oldParam, int newParam), IGH_Param[]>();

        foreach (var mapping in _outputMappings)
        {
            var oldIndex = mapping.Key;
            var newIndex = mapping.Value;

            var oldOutput = oldOutputs[oldIndex];
            var recipients = oldOutput.Recipients.ToArray();
            recipientMappings[(oldOutput, newIndex)] = recipients;
        }

        var newComponent = GH_UpgradeUtil.SwapComponents(_oldComponent, UpgradeTo, false);

        // Then migrate all sources
        foreach (var sourceMapping in sourceMappings)
        {
            var (oldParam, newParam) = sourceMapping.Key;
            var sources = sourceMapping.Value;
            if (newParam >= newComponent.Params.Input.Count) continue;

            var newParamObj = newComponent.Params.Input[newParam];

            GH_UpgradeUtil.MigrateSources(sources, newParamObj);
        }

        // Finally, internalize data and migrate param metadata for all mapped inputs
        foreach (var sourceMapping in sourceMappings)
        {
            var (oldParam, newParam) = sourceMapping.Key;
            var sources = sourceMapping.Value;

            if (newParam >= newComponent.Params.Input.Count) continue;

            var newParamObj = newComponent.Params.Input[newParam];

            MigrateParamMetadata(oldParam, newParamObj);

            if (sources.Length == 0) MigrateInternalizedData(oldParam, newParamObj);
        }

        // Then migrate all recipients
        foreach (var recipientMapping in recipientMappings)
        {
            var (oldOutput, newOutput) = recipientMapping.Key;
            var recipients = recipientMapping.Value;

            if (newOutput >= newComponent.Params.Output.Count) continue;

            var newOutputObj = newComponent.Params.Output[newOutput];

            GH_UpgradeUtil.MigrateRecipients(recipients, newOutputObj);
        }

        return newComponent;
    }

    /// <summary>
    ///     Migrate param-level metadata that applies to all parameter types (invert, simplify, graft/flatten, etc.)
    /// </summary>
    private static void MigrateParamMetadata(IGH_Param oldParam, IGH_Param newParam)
    {
        newParam.Reverse = oldParam.Reverse;
        newParam.Simplify = oldParam.Simplify;
        newParam.DataMapping = oldParam.DataMapping;
        newParam.WireDisplay = oldParam.WireDisplay;
        newParam.NickName = oldParam.NickName;

        if (oldParam is GH_ExpressionParam<IGH_Goo> oldExpr && newParam is GH_ExpressionParam<IGH_Goo> newExpr)
            newExpr.Expression = oldExpr.Expression;

        if (oldParam is Param_Number oldNum && newParam is Param_Number newNum)
        {
            newNum.AngleParameter = oldNum.AngleParameter;
            newNum.UseDegrees = oldNum.UseDegrees;
            newNum.Expression = oldNum.Expression;
        }

        if (oldParam is Param_Boolean oldBool && newParam is Param_Boolean newBool) newBool.Invert = oldBool.Invert;
    }

    /// <summary>
    ///     Migrate internalized data between parameters of various types
    /// </summary>
    private void MigrateInternalizedData(IGH_Param oldParam, IGH_Param newParam)
    {
        // Handle Param_Integer
        if (oldParam is Param_Integer oldInt && newParam is Param_Integer newInt)
        {
            newInt.PersistentData.Clear();
            foreach (var data in oldInt.PersistentData.AllData(true))
                if (data is GH_Integer ghInt)
                    newInt.PersistentData.Append(new GH_Integer(ghInt.Value));
        }
        // Handle Param_Number
        else if (oldParam is Param_Number oldNum && newParam is Param_Number newNum)
        {
            newNum.PersistentData.Clear();
            foreach (var data in oldNum.PersistentData.AllData(true))
                if (data is GH_Number ghNum)
                    newNum.PersistentData.Append(new GH_Number(ghNum.Value));
        }

        // Handle Param_Boolean
        else if (oldParam is Param_Boolean oldBool && newParam is Param_Boolean newBool)
        {
            newBool.PersistentData.Clear();
            foreach (var data in oldBool.PersistentData.AllData(true))
                if (data is GH_Boolean ghBool)
                    newBool.PersistentData.Append(new GH_Boolean(ghBool.Value));
        }
        // Handle Param_String
        else if (oldParam is Param_String oldStr && newParam is Param_String newStr)
        {
            newStr.PersistentData.Clear();
            foreach (var data in oldStr.PersistentData.AllData(true))
                if (data is GH_String ghStr)
                    newStr.PersistentData.Append(new GH_String(ghStr.Value));
        }
        else
        {
            // Fallback for any GH_PersistentParam<T> (geometry, brep, curve, etc.)
            // PersistentData is GH_Structure<T> — use CopyFrom via reflection since T is unknown
            var oldProp = oldParam.GetType()
                .GetProperty("PersistentData", BindingFlags.Public | BindingFlags.Instance);
            var newProp = newParam.GetType()
                .GetProperty("PersistentData", BindingFlags.Public | BindingFlags.Instance);
            if (oldProp != null && newProp != null)
            {
                var oldData = oldProp.GetValue(oldParam);
                var newData = newProp.GetValue(newParam);
                if (oldData != null && newData != null)
                    newData.GetType()
                        .GetMethod("CopyFrom", BindingFlags.Public | BindingFlags.Instance)
                        ?.Invoke(newData, [oldData]);
            }
        }
    }
}
