import {
	App,
	applyDocumentTheme,
	applyHostFonts,
	applyHostStyleVariables,
	type McpUiHostContext
} from '@modelcontextprotocol/ext-apps';
import {
	clearGeometryCache,
	getThreeObjectsFromComputeResponse,
	setTextureAnisotropy
} from '@selvajs/visualization/parse';
import { initThree, updateScene } from '@selvajs/visualization/render';
import { SOLVE_VIEW_KEY, type SolveViewData } from '../app.js';

export { SOLVE_VIEW_KEY, type SolveViewData } from '../app.js';
export type { App } from '@modelcontextprotocol/ext-apps';

/** A tool result as the host hands it to a view. */
export interface ViewToolResult {
	content?: unknown[];
	_meta?: Record<string, unknown>;
	isError?: boolean;
}

function applyHostContext(context: McpUiHostContext | undefined): void {
	if (!context) return;
	if (context.theme) applyDocumentTheme(context.theme);
	if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
	if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

/**
 * Connects a view to its host and follows the host's theme, colours and fonts. Add listeners in
 * `listen`: the host sends the first tool result right after the handshake, before this resolves.
 */
export async function connectView(
	info: { name: string; version: string },
	listen?: (app: App) => void
): Promise<App> {
	const app = new App(info);
	app.addEventListener('hostcontextchanged', applyHostContext);
	listen?.(app);
	await app.connect();
	applyHostContext(app.getHostContext());
	return app;
}

/** The text a tool result carries, for a view to show when it has nothing else. */
export function resultText(result: ViewToolResult): string {
	return (result.content ?? [])
		.flatMap((c) => {
			const block = c as { type?: string; text?: string };
			return block.type === 'text' && block.text ? [block.text] : [];
		})
		.join('\n');
}

export function solveViewData(result: ViewToolResult): SolveViewData | undefined {
	return result._meta?.[SOLVE_VIEW_KEY] as SolveViewData | undefined;
}

/** The geometry a solve view draws: inline, or from its `load` tool. Undefined when there is none. */
export async function loadSolveResponse(app: App, data: SolveViewData): Promise<unknown> {
	if (data.response !== undefined) return data.response;
	if (!data.load) return undefined;
	const loaded = (await app.callServerTool({
		name: data.load.tool,
		arguments: data.load.arguments ?? {}
	})) as ViewToolResult;
	if (loaded.isError) throw new Error(resultText(loaded) || `${data.load.tool} failed`);
	return solveViewData(loaded)?.response;
}

export interface SolveViewer {
	/** Replaces what it shows; the camera frames the first geometry it gets. */
	show(response: unknown): Promise<number>;
	fitToView(): void;
	dispose(): void;
}

/** A 3D viewer filling `container`, drawing Rhino.Compute responses. */
export function mountSolveViewer(container: HTMLElement): SolveViewer {
	const canvas = document.createElement('canvas');
	canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
	container.append(canvas);
	// No HDR: a view may not fetch, and the generated reflection environment lights it well enough.
	const viewer = initThree(canvas, {
		onMaxAnisotropy: setTextureAnisotropy,
		environment: { hdrPath: false }
	});
	let framed = false;
	return {
		async show(response) {
			const objects = await getThreeObjectsFromComputeResponse(response as never);
			updateScene(viewer.scene, objects, viewer.camera, viewer.controls, framed);
			framed ||= objects.length > 0;
			viewer.updateGridScale();
			viewer.invalidate();
			return objects.length;
		},
		fitToView: () => viewer.fitToView(),
		dispose() {
			viewer.dispose();
			// Parsed geometry outlives the viewer otherwise: the cache is page-wide.
			clearGeometryCache();
			canvas.remove();
		}
	};
}
