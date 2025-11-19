using System;
using Grasshopper.Kernel;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Helper class for parameter type checking
    /// Consolidates repeated type validation logic
    /// </summary>
    public static class ParameterTypeHelper
    {
        /// <summary>
        /// Check if an object is a context output component (ContextPrintComponent or ContextBakeComponent)
        /// </summary>
        public static bool IsContextOutputComponent(IGH_DocumentObject obj)
        {
            if (obj == null)
                return false;

            var typeName = obj.GetType()?.Name;
            return string.Equals(typeName, "ContextPrintComponent", StringComparison.Ordinal);
            //string.Equals(typeName, "ContextBakeComponent", StringComparison.Ordinal); //Maybe add later again
        }
    }
}
