using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;

namespace SheepMetal.PluginGrasshopper.Upgraders;

/// <summary>
///     Migrates wire connections, internalized data, and param metadata from an old component
///     to its upgraded replacement, keyed by explicit old-index → new-index mappings.
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

    public GH_ComponentUpgradeHelper MapInput(int oldIndex, int newIndex)
    {
        _inputMappings[oldIndex] = newIndex;
        return this;
    }

    public GH_ComponentUpgradeHelper MapOutput(int oldIndex, int newIndex)
    {
        _outputMappings[oldIndex] = newIndex;
        return this;
    }

    public GH_ComponentUpgradeHelper MapAllInputs()
    {
        var oldInputs = _oldComponent.Params.Input;
        for (var i = 0; i < oldInputs.Count; i++)
        {
            _inputMappings[i] = i;
        }

        return this;
    }

    public GH_ComponentUpgradeHelper MapAllOuputs()
    {
        var oldOutputs = _oldComponent.Params.Output;
        for (var i = 0; i < oldOutputs.Count; i++)
        {
            _outputMappings[i] = i;
        }

        return this;
    }

    /// <summary>
    ///     Runs the swap: reconnects mapped inputs/outputs, and for any mapped input with no
    ///     wired source, internalizes its old persistent data instead.
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

        var recipientMappings = new Dictionary<(IGH_Param oldParam, int newParam), IGH_Param[]>();

        foreach (var mapping in _outputMappings)
        {
            var oldIndex = mapping.Key;
            var newIndex = mapping.Value;

            var oldOutput = oldOutputs[oldIndex];
            var recipients = oldOutput.Recipients.ToArray();
            recipientMappings[(oldOutput, newIndex)] = recipients;
        }

        // Sources/recipients had to be collected above, before the swap: SwapComponents
        // disposes the old params, so anything read from them afterward is stale.
        var newComponent = GH_UpgradeUtil.SwapComponents(_oldComponent, UpgradeTo, false);

        foreach (var sourceMapping in sourceMappings)
        {
            var (oldParam, newParam) = sourceMapping.Key;
            var sources = sourceMapping.Value;
            if (newParam >= newComponent.Params.Input.Count)
            {
                continue;
            }

            var newParamObj = newComponent.Params.Input[newParam];

            GH_UpgradeUtil.MigrateSources(sources, newParamObj);
        }

        foreach (var sourceMapping in sourceMappings)
        {
            var (oldParam, newParam) = sourceMapping.Key;
            var sources = sourceMapping.Value;

            if (newParam >= newComponent.Params.Input.Count)
            {
                continue;
            }

            var newParamObj = newComponent.Params.Input[newParam];

            MigrateParamMetadata(oldParam, newParamObj);

            if (sources.Length == 0)
            {
                MigrateInternalizedData(oldParam, newParamObj);
            }
        }

        foreach (var recipientMapping in recipientMappings)
        {
            var (oldOutput, newOutput) = recipientMapping.Key;
            var recipients = recipientMapping.Value;

            if (newOutput >= newComponent.Params.Output.Count)
            {
                continue;
            }

            var newOutputObj = newComponent.Params.Output[newOutput];

            GH_UpgradeUtil.MigrateRecipients(recipients, newOutputObj);
        }

        return newComponent;
    }

    private static void MigrateParamMetadata(IGH_Param oldParam, IGH_Param newParam)
    {
        newParam.Reverse = oldParam.Reverse;
        newParam.Simplify = oldParam.Simplify;
        newParam.DataMapping = oldParam.DataMapping;
        newParam.WireDisplay = oldParam.WireDisplay;
        newParam.NickName = oldParam.NickName;

        if (oldParam is GH_ExpressionParam<IGH_Goo> oldExpr && newParam is GH_ExpressionParam<IGH_Goo> newExpr)
        {
            newExpr.Expression = oldExpr.Expression;
        }

        if (oldParam is Param_Number oldNum && newParam is Param_Number newNum)
        {
            newNum.AngleParameter = oldNum.AngleParameter;
            newNum.UseDegrees = oldNum.UseDegrees;
            newNum.Expression = oldNum.Expression;
        }

        if (oldParam is Param_Boolean oldBool && newParam is Param_Boolean newBool)
        {
            newBool.Invert = oldBool.Invert;
        }
    }

    private void MigrateInternalizedData(IGH_Param oldParam, IGH_Param newParam)
    {
        if (oldParam is Param_Integer oldInt && newParam is Param_Integer newInt)
        {
            newInt.PersistentData.Clear();
            foreach (var data in oldInt.PersistentData.AllData(true))
            {
                if (data is GH_Integer ghInt)
                {
                    newInt.PersistentData.Append(new GH_Integer(ghInt.Value));
                }
            }
        }
        else if (oldParam is Param_Number oldNum && newParam is Param_Number newNum)
        {
            newNum.PersistentData.Clear();
            foreach (var data in oldNum.PersistentData.AllData(true))
            {
                if (data is GH_Number ghNum)
                {
                    newNum.PersistentData.Append(new GH_Number(ghNum.Value));
                }
            }
        }
        else if (oldParam is Param_Boolean oldBool && newParam is Param_Boolean newBool)
        {
            newBool.PersistentData.Clear();
            foreach (var data in oldBool.PersistentData.AllData(true))
            {
                if (data is GH_Boolean ghBool)
                {
                    newBool.PersistentData.Append(new GH_Boolean(ghBool.Value));
                }
            }
        }
        else if (oldParam is Param_String oldStr && newParam is Param_String newStr)
        {
            newStr.PersistentData.Clear();
            foreach (var data in oldStr.PersistentData.AllData(true))
            {
                if (data is GH_String ghStr)
                {
                    newStr.PersistentData.Append(new GH_String(ghStr.Value));
                }
            }
        }
        else
        {
            // Fallback for GH_PersistentParam<T> types not special-cased above (geometry,
            // brep, curve, etc). T is unknown here, so go through reflection to call
            // GH_Structure<T>.CopyFrom instead of a generic cast.
            var oldProp = oldParam.GetType()
                .GetProperty("PersistentData", BindingFlags.Public | BindingFlags.Instance);
            var newProp = newParam.GetType()
                .GetProperty("PersistentData", BindingFlags.Public | BindingFlags.Instance);
            if (oldProp != null && newProp != null)
            {
                var oldData = oldProp.GetValue(oldParam);
                var newData = newProp.GetValue(newParam);
                if (oldData != null && newData != null)
                {
                    newData.GetType()
                        .GetMethod("CopyFrom", BindingFlags.Public | BindingFlags.Instance)
                        ?.Invoke(newData, [oldData]);
                }
            }
        }
    }
}
