import type { CameraView, ThreeViewer } from '@selvajs/visualization/render';

// The builder has no viewer of its own: the author frames the model in Preview, and the builder's
// viewer settings save what Preview last showed. Module state, so it outlives the preview page
// when the author switches back to the builder; keyed by session, so one definition's view never
// lands in another's schema.
let latest = $state<{ sessionId: string; view: CameraView } | null>(null);

/** The view Preview last showed for `sessionId`, or null when it has not drawn that session's model. */
export function previewCamera(sessionId: string): CameraView | null {
	return latest?.sessionId === sessionId ? latest.view : null;
}

/**
 * Returns an `onViewerReady` that follows the viewer's camera until its cleanup runs. The first
 * solve's framing calls `controls.update()`, which fires `change`, so a model that is drawn but
 * never orbited still counts. The last view stays readable after the viewer is gone.
 */
export function trackPreviewCamera(sessionId: string): (viewer: ThreeViewer) => () => void {
	return (viewer) => {
		let frame = 0;
		const read = () => {
			frame = 0;
			latest = { sessionId, view: viewer.cameraController.getCameraView() };
		};
		// One read per frame: an orbit fires `change` on every pointer move.
		const onChange = () => {
			frame ||= requestAnimationFrame(read);
		};
		viewer.controls.addEventListener('change', onChange);
		return () => {
			viewer.controls.removeEventListener('change', onChange);
			if (frame) cancelAnimationFrame(frame);
		};
	};
}
