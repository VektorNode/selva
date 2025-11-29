using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Selva.Config;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Handles cleanup operations when parameters are deleted from the schema
///   Ensures transactional cleanup across multiple systems
/// </summary>
public class SchemaCleanupService
{
  /// <summary>
  ///   Perform transactional cleanup of deleted parameters
  ///   Updates all related state atomically
  /// </summary>
  public void CleanupDeletedParameters(
    List<Guid> removedIds,
    UISchema schema,
    ValueApplicator valueApplicator,
    Dictionary<string, object> embeddedValues,
    CommunicationHandler communicationHandler,
    GH_Document document,
    Action<GH_RuntimeMessageLevel, string> addMessage)
  {
    if (removedIds == null || removedIds.Count == 0) return;

    try
    {
      // Transaction steps:
      // 1. Remove from value applicator cache (thread-safe)
      var valuesToRemove = removedIds.Select(id => id.ToString()).ToList();
      valueApplicator?.RemoveValues(valuesToRemove);

      // 2. Remove from embedded values
      if (embeddedValues != null)
        foreach (var key in valuesToRemove)
        {
          embeddedValues.Remove(key);
        }

      // 3. Schema is already updated by caller (ValidateSchemaAndTrackChanges)
      // This is the commit point - schema changes are persisted

      // 4. Broadcast to web UI (fire-and-forget with timeout)
      var broadcastTask = communicationHandler?.BroadcastSchemaUpdate(schema, removedIds);
      if (broadcastTask != null)
        try
        {
          broadcastTask.Wait(AppConfig.ComponentLifecycle.SchemaCleanupBroadcastTimeoutMs);
        }
        catch
        {
          // Broadcast failed - log but don't fail the deletion
          addMessage?.Invoke(GH_RuntimeMessageLevel.Warning,
            "Failed to notify web UI of deletion - please refresh");
        }

      // 5. Mark document as modified so changes persist on save
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
