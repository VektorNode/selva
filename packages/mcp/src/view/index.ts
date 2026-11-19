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
import { SOLVE_VIEW_KEY, type SolveViewData, type SolveViewForm } from '../app.js';

export { SOLVE_VIEW_KEY, type SolveViewData, type SolveViewForm, type ViewInput } from '../app.js';
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

export interface ViewFormHandle {
	/** The values as the user left them, by input name. A field left empty is absent. */
	values(): Record<string, unknown>;
	/** Disables the controls while a solve runs. */
	setBusy(busy: boolean): void;
}

/**
 * Draws `form`'s inputs into `container`, replacing what was there, with a Solve button that
 * calls `onSolve`. Plain DOM, styled by the page.
 */
export function renderViewForm(
	container: HTMLElement,
	form: SolveViewForm,
	onSolve: (values: Record<string, unknown>) => void
): ViewFormHandle {
	container.replaceChildren();
	// A reader returns undefined for a field left empty, so the solve keeps the file's value.
	const readers: (() => [string, unknown] | undefined)[] = [];
	const controls: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

	for (const input of form.inputs) {
		const field = document.createElement('label');
		field.className = 'field';
		const name = document.createElement('span');
		name.className = 'name';
		name.textContent = input.unit ? `${input.name} (${input.unit})` : input.name;
		if (input.description) field.title = input.description;
		field.append(name);

		let control: HTMLInputElement | HTMLSelectElement;
		if (input.kind === 'choice') {
			const select = document.createElement('select');
			if (typeof input.value !== 'string') select.add(new Option('', ''));
			for (const option of input.options ?? []) select.add(new Option(option, option));
			select.value = typeof input.value === 'string' ? input.value : '';
			control = select;
			readers.push(() => (select.value === '' ? undefined : [input.name, select.value]));
		} else if (input.kind === 'boolean') {
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.checked = input.value === true;
			control = box;
			readers.push(() => [input.name, box.checked]);
			field.classList.add('inline');
		} else {
			const box = document.createElement('input');
			box.type = input.kind === 'number' ? 'number' : 'text';
			if (input.min !== undefined) box.min = String(input.min);
			if (input.max !== undefined) box.max = String(input.max);
			box.step = input.step !== undefined ? String(input.step) : 'any';
			const initial = input.value !== undefined && input.value !== null ? String(input.value) : '';
			box.value = initial;
			control = box;
			readers.push(() => {
				if (input.kind === 'number')
					return box.value === '' ? undefined : [input.name, Number(box.value)];
				// A text field emptied on purpose is a value; one that started empty is not.
				return box.value === '' && initial === '' ? undefined : [input.name, box.value];
			});
		}
		controls.push(control);
		field.append(control);
		container.append(field);
	}

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'solve';
	button.textContent = 'Solve';
	controls.push(button);
	container.append(button);

	const values = () =>
		Object.fromEntries(
			readers.map((read) => read()).filter((entry) => entry !== undefined)
		) as Record<string, unknown>;
	button.addEventListener('click', () => onSolve(values()));
	container.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !button.disabled) onSolve(values());
	});

	return {
		values,
		setBusy(busy) {
			for (const c of controls) c.disabled = busy;
			button.textContent = busy ? 'Solving…' : 'Solve';
		}
	};
}
