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

        /// <summary>
        /// Check if an object is a contextual parameter (IGH_ContextualParameter)
        /// </summary>
        public static bool IsContextualParameter(IGH_DocumentObject obj)
        {
            return obj is IGH_ContextualParameter;
        }

        /// <summary>
        /// Check if an object is either a contextual parameter or a context output component
        /// </summary>
        public static bool IsValidContextObject(IGH_DocumentObject obj)
        {
            return IsContextualParameter(obj) || IsContextOutputComponent(obj);
        }
    }
}
