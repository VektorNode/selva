using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Rhino;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Cleans up value-applicator cache, embedded values, and web UI state when parameters
///     are deleted from the schema, so no system is left holding a stale param id.
/// </summary>
public class SchemaCleanupService
{
    public void CleanupDeletedParameters(
        List<Guid> removedIds,
        UISchema schema,
        ValueApplicator valueApplicator,
        Dictionary<string, object> embeddedValues,
        WebSocketTransport webSocketTransport,
        GH_Document document,
        Action<GH_RuntimeMessageLevel, string> addMessage)
    {
        if (removedIds == null || removedIds.Count == 0)
        {
            return;
        }

        try
        {
            var valuesToRemove = removedIds.Select(id => id.ToString()).ToList();
            valueApplicator?.RemoveValues(valuesToRemove);

            if (embeddedValues != null)
            {
                foreach (var key in valuesToRemove)
                {
                    embeddedValues.Remove(key);
                }
            }

            // Schema itself was already updated by the caller (ValidateSchemaAndTrackChanges);
            // this is just the fan-out to the other systems that cache a copy of param ids.
            var broadcastTask = webSocketTransport?.BroadcastSchemaUpdate(schema, removedIds);
            if (broadcastTask != null)
            {
                _ = broadcastTask.ContinueWith(t =>
                {
                    if (t.IsFaulted)
                    {
                        Logger.Error("Failed to notify web UI of deletion", t.Exception);
                        RhinoApp.InvokeOnUiThread(new Action(() =>
                            addMessage?.Invoke(GH_RuntimeMessageLevel.Warning, "Failed to notify web UI of deletion")));
                    }
                });
            }

            document?.Modified();

            addMessage?.Invoke(GH_RuntimeMessageLevel.Remark,
                $"Cleaned up {removedIds.Count} deleted parameter(s)");
        }
        catch (Exception ex)
        {
            addMessage?.Invoke(GH_RuntimeMessageLevel.Error,
                $"Error during parameter deletion cleanup: {ex.Message}");
        }
    }
}
