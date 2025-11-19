using System;
using ComputeBuilder.Plugin.Models.Generated;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;

namespace ComputeBuilder.Plugin.Utils
{
    /// <summary>
    ///     Helper class for parameter type checking
    ///     Consolidates repeated type validation logic
    /// </summary>
    public static class ParameterTypeHelper
    {
        /// <summary>
        ///     Check if an object is a context output component (ContextPrintComponent or ContextBakeComponent)
        /// </summary>
        public static bool IsContextOutputComponent(IGH_DocumentObject obj)
        {
            if (obj == null)
            {
                return false;
            }

            var typeName = obj.GetType()?.Name;
            return string.Equals(typeName, "ContextPrintComponent", StringComparison.Ordinal);
            //string.Equals(typeName, "ContextBakeComponent", StringComparison.Ordinal); //Maybe add later again
        }


        /// <summary>
        /// Extract minimum, maximum, and step size from a contextual parameter
        /// Prioritizes slider values if connected, falls back to parameter properties
        /// </summary>
        public static void ExtractNumberParameterConstraints(
            IGH_ContextualParameter param,
            IGH_Param ghParam,
            AvailableParameter availableParam)
        {
            double? minimum = null;
            double? maximum = null;
            decimal? stepSize = null;

            var getNumberType = param.GetType();

            // Try to get min/max from parameter properties
            if (getNumberType.Name == "GetNumberParameter")
            {
                ExtractParameterMinMax(param, availableParam, ref minimum, ref maximum);
            }

            // If source is a slider, override with slider values
            if (ghParam?.SourceCount == 1 && ghParam.Sources[0] is GH_NumberSlider slider)
            {
                try
                {
                    minimum = (double)slider.Slider.Minimum;
                    maximum = (double)slider.Slider.Maximum;
                    stepSize = slider.Slider.Epsilon;
                }
                catch (Exception ex)
                {
                    Console.WriteLine(
                        $"Warning: Failed to extract slider constraints for '{availableParam.Nickname}': {ex.Message}");
                }
            }
            else if (getNumberType.Name == "GetNumberParameter")
            {
                ExtractDecimalPlacesStepSize(param, ref stepSize);
            }

            // Apply extracted values
            if (minimum.HasValue && maximum.HasValue)
            {
                availableParam.Minimum = minimum.Value;
                availableParam.Maximum = maximum.Value;
                if (stepSize.HasValue)
                {
                    availableParam.StepSize = (double)stepSize.Value;
                }
            }
            else
            {
                Console.WriteLine(
                    $"Warning: Parameter '{availableParam.Nickname}' does not have valid Minimum/Maximum values");
            }
        }

        private static void ExtractParameterMinMax(
            IGH_ContextualParameter param,
            AvailableParameter availableParam,
            ref double? minimum,
            ref double? maximum)
        {
            var minProp = param.GetType().GetProperty("Minimum");
            var maxProp = param.GetType().GetProperty("Maximum");

            if (minProp == null || maxProp == null)
                return;

            try
            {
                var minValue = Convert.ToDouble(minProp.GetValue(param));
                var maxValue = Convert.ToDouble(maxProp.GetValue(param));

                if (!double.IsNegativeInfinity(minValue) && !double.IsNaN(minValue) && minValue != 0)
                {
                    minimum = minValue;
                }

                if (!double.IsPositiveInfinity(maxValue) && !double.IsNaN(maxValue) && maxValue != 0)
                {
                    maximum = maxValue;
                }
            }
            catch (InvalidCastException ex)
            {
                Console.WriteLine(
                    $"Warning: Failed to cast Minimum/Maximum properties for '{availableParam.Nickname}': {ex.Message}");
            }
        }

        private static void ExtractDecimalPlacesStepSize(
            IGH_ContextualParameter param,
            ref decimal? stepSize)
        {
            var decimalsProp = param.GetType().GetProperty("DecimalPlaces");
            if (decimalsProp == null)
                return;

            try
            {
                var decimals = (int)decimalsProp.GetValue(param);
                if (decimals >= 0)
                {
                    stepSize = (decimal)Math.Pow(10, -decimals);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Warning: Failed to extract DecimalPlaces: {ex.Message}");
            }
        }
    }
}