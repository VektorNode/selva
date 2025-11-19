using System;
using System.Linq;
using Grasshopper.Kernel;
using ComputeBuilder.Models;

namespace ComputeBuilder.Components
{
    /// <summary>
    /// Component to clear contextual data from parameters
    /// Releases internal data to free up memory
    /// </summary>
    public class ClearContextDataComponent : GH_Component
    {
        public ClearContextDataComponent()
            : base("Clear Context Data", "Clear",
                "Release contextual data from parameters to free up memory",
                "ComputeBuilder", "Core")
        {
        }

        public override Guid ComponentGuid => new Guid("C3D4E5F6-A7B8-4C5D-9E0F-1A2B3C4D5E6F");

        protected override void RegisterInputParams(GH_InputParamManager pManager)
        {
            pManager.AddBooleanParameter("Clear", "Clear", "Clear contextual data from all contextual parameters in the document", GH_ParamAccess.item, false);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Info", "Info", "Status information", GH_ParamAccess.item);
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            bool clear = false;

            DA.GetData(0, ref clear);

            var document = this.OnPingDocument();
            if (document == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Could not access Grasshopper document");
                DA.SetData(0, "ERROR: No document");
                return;
            }

            // Find all contextual parameters in the document
            var contextualParams = document.Objects
                .OfType<IGH_ContextualParameter>()
                .ToList();

            if (!clear)
            {
                DA.SetData(0, $"Found {contextualParams.Count} contextual parameters\nSet 'Clear' to true to execute");
                return;
            }

            int clearedCount = 0;
            int errorCount = 0;
            var recipientsToExpire = new System.Collections.Generic.HashSet<IGH_ActiveObject>();

            foreach (var contextParam in contextualParams)
            {
                var paramObject = contextParam as IGH_DocumentObject;

                try
                {
                    // Call ClearContextualData to release the internal data
                    var clearMethod = contextParam.GetType().GetMethod("ClearContextualData");
                    if (clearMethod != null)
                    {
                        clearMethod.Invoke(contextParam, null);
                        clearedCount++;

                        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                            $"Cleared: {paramObject?.NickName ?? "Unknown"}");
                    }

                    var CollectVolatileData_FromSources = contextParam.GetType().GetMethod("CollectVolatileData_FromSources");
                    if (CollectVolatileData_FromSources != null)
                    {
                        CollectVolatileData_FromSources.Invoke(contextParam, null);
                    }

                    // Collect all components that receive data from this parameter
                    if (contextParam is IGH_Param param)
                    {
                        foreach (var recipient in param.Recipients)
                        {
                            if (recipient is IGH_ActiveObject activeRecipient)
                            {
                                recipientsToExpire.Add(activeRecipient);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Error clearing {paramObject?.NickName ?? "Unknown"}: {ex.Message}");
                    errorCount++;
                }
            }

            // Now expire all recipient components
            foreach (var recipient in recipientsToExpire)
            {
                try
                {
                    recipient.ExpirePreview(false);
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Error expiring component: {ex.Message}");
                }
            }

            DA.SetData(0, $"Cleared: {clearedCount} parameters\nExpired: {recipientsToExpire.Count} components\nErrors: {errorCount}");
        }

        protected override System.Drawing.Bitmap Icon => null;
    }
}
