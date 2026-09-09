using System;
using System.Collections.Generic;
using Grasshopper.Kernel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Walks the document after a solution ends and collects every component's runtime messages.
/// </summary>
/// <remarks>
///     Reporting is deliberately wider than blocking. Any component's error is worth showing —
///     a Python component failing is exactly what an author needs to see — but only a Selva
///     Message component's error blocks the outputs. Blocking on every error would break working
///     definitions: Selva's own ValueApplicator raises Error for routine input coercion, and some
///     definitions error by design while still producing correct geometry (the same reason
///     `cacheerroredsolves` exists on the Compute path).
/// </remarks>
public static class SolveDiagnosticsCollector
{
    private const string MessageComponentTypeName = "GH_Message";

    public static SolveDiagnostics Collect(GH_Document document)
    {
        var diagnostics = new SolveDiagnostics();
        if (document == null)
        {
            return diagnostics;
        }

        // Full scan, never an incremental cache of known components: undo, paste, or a solve that
        // ran while the WS server was down all leave an id cache stale, and a missed error is one
        // the author never sees. O(objects) once per solve-end.
        foreach (var docObject in document.Objects)
        {
            if (!(docObject is IGH_ActiveObject activeObject))
            {
                continue;
            }

            var isGate = docObject.GetType().Name == MessageComponentTypeName;
            var nickname = string.IsNullOrWhiteSpace(docObject.NickName)
                ? docObject.GetType().Name
                : docObject.NickName;

            CollectLevel(activeObject, GH_RuntimeMessageLevel.Error, "error", nickname, isGate,
                diagnostics);
            CollectLevel(activeObject, GH_RuntimeMessageLevel.Warning, "warning", nickname, isGate,
                diagnostics);
            CollectLevel(activeObject, GH_RuntimeMessageLevel.Remark, "remark", nickname, isGate,
                diagnostics);
        }

        return diagnostics;
    }

    private static void CollectLevel(IGH_ActiveObject activeObject, GH_RuntimeMessageLevel level,
        string wireLevel, string nickname, bool isGate, SolveDiagnostics diagnostics)
    {
        IList<string> messages;
        try
        {
            messages = activeObject.RuntimeMessages(level);
        }
        catch (Exception)
        {
            // A component throwing while being asked for its messages must not take down the
            // whole solve report.
            return;
        }

        if (messages == null)
        {
            return;
        }

        foreach (var message in messages)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                continue;
            }

            // The marker exists for Rhino.Compute, which has no structural way to tell a block
            // from any other error. Locally `isGate` carries that, so strip it rather than show
            // the user a wire detail.
            var text = message.Replace(SolveDiagnostics.BlockedMarker, string.Empty).Trim();

            diagnostics.Messages.Add(new SolveDiagnostic
            {
                Level = wireLevel,
                Message = text.Length > 0 ? text : message,
                Source = nickname,
                IsGate = isGate
            });

            if (isGate && level == GH_RuntimeMessageLevel.Error)
            {
                diagnostics.Blocked = true;
            }
        }
    }
}
