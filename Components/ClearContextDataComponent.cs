using System;
using System.Linq;
using Grasshopper.Kernel;
using ComputeBuilder.Utils;
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
            pManager.AddTextParameter("Session ID", "ID", "Session ID from Schema Builder", GH_ParamAccess.item);
            pManager.AddBooleanParameter("Clear", "Clear", "Clear contextual data from all inputs in the schema", GH_ParamAccess.item, false);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Info", "Info", "Status information", GH_ParamAccess.item);
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            string sessionId = "";
            bool clear = false;

            if (!DA.GetData(0, ref sessionId)) return;
            DA.GetData(1, ref clear);

            var schema = SessionManager.ReadJson<UISchema>(SessionManager.GetSchemaPath(sessionId));
            if (schema == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"No schema found for session {sessionId}");
                DA.SetData(0, "ERROR: Schema not found");
                return;
            }

            var document = this.OnPingDocument();
            if (document == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Could not access Grasshopper document");
                DA.SetData(0, "ERROR: No document");
                return;
            }

            if (!clear)
            {
                DA.SetData(0, $"Session: {sessionId}\nReady to clear {schema.Inputs.Count} parameters\nSet 'Clear' to true to execute");
                return;
            }

            int clearedCount = 0;
            int errorCount = 0;
            var recipientsToExpire = new System.Collections.Generic.HashSet<IGH_ActiveObject>();

            foreach (var input in schema.Inputs)
            {
                var paramObject = document.FindObject(input.Id, false);
                if (paramObject == null)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Parameter '{input.Name}' not found in document");
                    errorCount++;
                    continue;
                }

                if (paramObject is IGH_ContextualParameter contextParam)
                {
                    try
                    {
                        // Call ClearContextualData to release the internal data
                        var clearMethod = contextParam.GetType().GetMethod("ClearContextualData");
                        if (clearMethod != null)
                        {
                            clearMethod.Invoke(contextParam, null);
                            clearedCount++;

                            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                                $"Cleared: {paramObject.NickName}");
                        }
                        
                        
                        var CollectVolatileData_FromSources = contextParam.GetType().GetMethod("CollectVolatileData_FromSources");
                        if (CollectVolatileData_FromSources != null)
                        {
                            CollectVolatileData_FromSources.Invoke(contextParam, null);
                        }
                        // Collect all components that receive data from this parameter
                        // We'll expire them AFTER clearing all parameters
                        if (paramObject is IGH_Param param)
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
                            $"Error clearing {paramObject.NickName}: {ex.Message}");
                        errorCount++;
                    }
                }
            }

            // Now expire all recipient components (not the parameters themselves)
            // This prevents the parameters from recalculating during the clear operation
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

            DA.SetData(0, $"Session: {sessionId}\nCleared: {clearedCount} parameters\nExpired: {recipientsToExpire.Count} components\nErrors: {errorCount}");
        }

        protected override System.Drawing.Bitmap Icon => null;
    }
}
