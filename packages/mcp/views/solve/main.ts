import {
	connectView,
	loadSolveResponse,
	mountSolveViewer,
	renderViewForm,
	resultText,
	solveViewData,
	type App,
	type SolveViewer,
	type SolveViewForm,
	type ViewToolResult
} from '../../src/view/index.js';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = byId('title');
const status = byId('status');
const fit = byId<HTMLButtonElement>('fit');
const fullscreen = byId<HTMLButtonElement>('fullscreen');
const formPanel = byId('form');

const say = (text: string) => {
	status.textContent = text;
	status.hidden = text === '';
};
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

let viewer: SolveViewer | undefined;
// Results can arrive faster than a `load` answers; only the newest may draw.
let latest = 0;

const app = await connectView({ name: 'Selva solve view', version: '1.0.0' }, (view) =>
	view.addEventListener('toolresult', (result) => void show(view, result))
);

async function show(view: App, result: ViewToolResult) {
	const turn = ++latest;
	const current = () => turn === latest;
	const data = solveViewData(result);
	title.textContent = data?.title ?? '';
	if (data?.form) showForm(view, data.form);
	if (result.isError) {
		say(resultText(result) || 'The solve failed.');
		return;
	}
	if (!data) {
		say(resultText(result) || 'This result has no geometry.');
		return;
	}
	say('Loading geometry…');
	try {
		const response = await loadSolveResponse(view, data);
		if (!current()) return;
		if (response === undefined) {
			say('This result has no geometry.');
			return;
		}
		viewer ??= mountSolveViewer(byId('stage'));
		const drawn = await viewer.show(response);
		if (!current()) return;
		say(drawn > 0 ? '' : 'The solve drew nothing.');
		fit.hidden = drawn === 0;
	} catch (err) {
		if (current()) say(`Could not draw the solve: ${message(err)}`);
	}
}

function showForm(view: App, form: SolveViewForm) {
	formPanel.hidden = form.inputs.length === 0;
	const handle = renderViewForm(formPanel, form, (values) => {
		handle.setBusy(true);
		say('Solving…');
		view
			.callServerTool({
				name: form.tool,
				arguments: { ...form.arguments, [form.valuesKey]: values }
			})
			.then(async (result) => {
				await show(view, result as ViewToolResult);
				// The model didn't see this solve; tell it what the user tried and got.
				const text = resultText(result as ViewToolResult);
				await view
					.updateModelContext({
						content: [
							{
								type: 'text',
								text: `The user solved again from the 3D view with ${JSON.stringify(values)}.\n${text}`
							}
						]
					})
					.catch(() => {});
			})
			.catch((err: unknown) => say(`Could not solve: ${message(err)}`))
			.finally(() => handle.setBusy(false));
	});
}

fit.addEventListener('click', () => viewer?.fitToView());

const setMode = (mode: string | undefined) => {
	document.body.classList.toggle('fullscreen', mode === 'fullscreen');
	fullscreen.textContent = mode === 'fullscreen' ? 'Exit fullscreen' : 'Fullscreen';
};
const followHost = () => {
	const context = app.getHostContext();
	fullscreen.hidden = !(context?.availableDisplayModes ?? []).includes('fullscreen');
	if (context?.displayMode) setMode(context.displayMode);
};
followHost();
app.addEventListener('hostcontextchanged', followHost);
fullscreen.addEventListener('click', () => {
	const next = document.body.classList.contains('fullscreen') ? 'inline' : 'fullscreen';
	app.requestDisplayMode({ mode: next }).then(
		({ mode }) => setMode(mode),
		(err: unknown) => say(`Could not change the display: ${message(err)}`)
	);
});
