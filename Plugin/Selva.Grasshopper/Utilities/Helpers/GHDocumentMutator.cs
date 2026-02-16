using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Rhino;
using Selva.Grasshopper.Config;

namespace Selva.Grasshopper.Utilities.Helpers;

/// <summary>
///   Provides utilities for common Grasshopper document mutation patterns.
///   Consolidates repeated patterns for scheduling component expiration and canvas refreshes.
/// </summary>
public static class GHDocumentMutator
{
	/// <summary>
	///   Schedule a component to expire its solution on the document scheduler.
	///   Uses the configured delay from AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs.
	/// </summary>
	/// <param name="document">The Grasshopper document</param>
	/// <param name="component">The component to expire (null-safe)</param>
	/// <param name="immediate">If true, fully expire the solution; if false, expire only downstream</param>
	public static void ScheduleComponentExpire(GH_Document document, GH_Component component, bool immediate = false)
	{
		if (document == null) return;

		document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs, _ =>
		{
			component?.ExpireSolution(immediate);
		});
	}

	/// <summary>
	///   Refresh the visual preview of multiple objects on the canvas.
	///   Expires preview for all objects and triggers a canvas redraw.
	/// </summary>
	/// <param name="document">The Grasshopper document</param>
	/// <param name="objects">The active objects whose preview should be refreshed</param>
	public static void RefreshObjectsOnCanvas(GH_Document document, IEnumerable<IGH_ActiveObject> objects)
	{
		if (document == null || objects == null) return;

		RhinoApp.InvokeOnUiThread(() =>
		{
			foreach (var obj in objects)
				obj?.ExpirePreview(true);

			document.NewSolution(false);
		});
	}
}
