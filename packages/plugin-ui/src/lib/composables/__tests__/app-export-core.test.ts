import { describe, expect, it } from 'vitest';
import {
	APP_NAME_MAX,
	appFileName,
	closeDialog,
	createInitialAppExportState,
	exportBlocker,
	openDialog,
	startExport,
	type AppExportDeps
} from '../app-export-core';

type Outcome = { file: Blob } | { error: Error };

function setup({ dirty = false, connected = true, saved = true } = {}) {
	const asked: { name: string; key: string; icon: string | null }[] = [];
	const savedFiles: { blob: Blob; fileName: string }[] = [];
	const toasts = { success: [] as string[], error: [] as string[] };
	const env = { dirty, connected, saved };
	let settle: (outcome: Outcome) => void = () => {};

	const state = createInitialAppExportState();
	const deps: AppExportDeps = {
		exporter: {
			get connected() {
				return env.connected;
			},
			exportApp: (name, key, icon) => {
				asked.push({ name, key, icon });
				return new Promise<Blob>((resolve, reject) => {
					settle = (outcome) => ('file' in outcome ? resolve(outcome.file) : reject(outcome.error));
				});
			}
		},
		save: async (blob, fileName) => {
			savedFiles.push({ blob, fileName });
			return env.saved;
		},
		notify: {
			success: (m) => toasts.success.push(m),
			error: (m) => toasts.error.push(m)
		},
		isSchemaDirty: () => env.dirty
	};

	const answer = (outcome: Outcome) => settle(outcome);
	return { state, deps, asked, savedFiles, toasts, answer };
}

const file = () => new Blob(['SLVX']);

describe('app file name', () => {
	it.each([
		['Tower massing', 'Tower massing.slvx'],
		['Façade 2', 'Façade 2.slvx'],
		['a/b\\c:d*e?f"g<h>i|j', 'abcdefghij.slvx'],
		['  Tower. ', 'Tower.slvx'],
		['line\nbreak', 'linebreak.slvx'],
		['...', 'app.slvx'],
		['', 'app.slvx']
	])('%j becomes %j', (name, expected) => {
		expect(appFileName(name)).toBe(expected);
	});
});

describe('export blocker', () => {
	it('lets a named app through', () => {
		const { state, deps } = setup();
		openDialog(state, 'Tower');
		expect(exportBlocker(state, deps)).toBeNull();
	});

	it('waits for the connection', () => {
		const { state, deps } = setup({ connected: false });
		openDialog(state, 'Tower');
		expect(exportBlocker(state, deps)).toBe('Not connected to Grasshopper.');
	});

	// The definition carries the last saved schema, so the draft on screen would not be in the app.
	it('refuses an unsaved schema', () => {
		const { state, deps } = setup({ dirty: true });
		openDialog(state, 'Tower');
		expect(exportBlocker(state, deps)).toBe('Save the schema first.');
	});

	it('needs a name the plugin can store', () => {
		const { state, deps } = setup();
		openDialog(state, '   ');
		expect(exportBlocker(state, deps)).toBe('Give the app a name.');

		state.name = 'x'.repeat(APP_NAME_MAX + 1);
		expect(exportBlocker(state, deps)).toMatch(/at most/);
	});
});

describe('the dialog', () => {
	it('opens on the schema name with no key, whatever the last opening left', () => {
		const { state } = setup();
		openDialog(state, 'Tower');
		state.name = 'Renamed';
		state.key = 'secret';
		state.keyShown = true;
		state.error = 'Earlier failure.';
		closeDialog(state);

		openDialog(state, 'Tower');

		expect(state).toMatchObject({
			open: true,
			name: 'Tower',
			key: '',
			keyShown: false,
			error: null
		});
	});
});

describe('exporting', () => {
	it('sends the trimmed name and the key as typed, then saves the file', async () => {
		const { state, deps, asked, savedFiles, toasts, answer } = setup();
		openDialog(state, 'Tower');
		state.name = ' Tower: north ';
		state.key = ' correct horse ';

		const exporting = startExport(state, deps);
		expect(state.exporting).toBe(true);
		expect(asked).toEqual([{ name: 'Tower: north', key: ' correct horse ', icon: null }]);

		const blob = file();
		answer({ file: blob });

		expect(await exporting).toBe(true);
		expect(savedFiles).toEqual([{ blob, fileName: 'Tower north.slvx' }]);
		expect(toasts.success).toEqual(['Exported Tower north.slvx.']);
		expect(state).toMatchObject({ open: false, key: '', exporting: false, error: null });
	});

	it('sends the picked icon, and keeps it for the next export', async () => {
		const { state, deps, asked, answer } = setup();
		openDialog(state, 'Tower');
		state.icon = 'iVBORw0KGgo=';

		const exporting = startExport(state, deps);
		expect(asked[0].icon).toBe('iVBORw0KGgo=');
		answer({ file: file() });
		await exporting;

		openDialog(state, 'Tower');
		expect(state.icon).toBe('iVBORw0KGgo=');
	});

	it('does nothing while blocked', async () => {
		const { state, deps, asked } = setup({ dirty: true });
		openDialog(state, 'Tower');

		expect(await startExport(state, deps)).toBe(false);
		expect(asked).toEqual([]);
		expect(state.exporting).toBe(false);
	});

	it('does not start a second export while one runs', async () => {
		const { state, deps, asked, answer } = setup();
		openDialog(state, 'Tower');
		const first = startExport(state, deps);

		expect(await startExport(state, deps)).toBe(false);
		expect(asked).toHaveLength(1);

		answer({ file: file() });
		await first;
	});

	it("shows the plugin's reason in the dialog and keeps the form", async () => {
		const { state, deps, toasts, answer } = setup();
		openDialog(state, 'Tower');
		state.key = 'secret';

		const exporting = startExport(state, deps);
		answer({ error: new Error('Grasshopper couldn’t serialise the definition.') });

		expect(await exporting).toBe(false);
		expect(state).toMatchObject({
			open: true,
			key: 'secret',
			exporting: false,
			error: 'Grasshopper couldn’t serialise the definition.'
		});
		expect(toasts.error).toEqual([]);
	});

	it('reports a failure as a toast once the dialog is closed', async () => {
		const { state, deps, toasts, answer } = setup();
		openDialog(state, 'Tower');

		const exporting = startExport(state, deps);
		closeDialog(state);
		answer({ error: new Error('Not connected to Grasshopper.') });

		expect(await exporting).toBe(false);
		expect(toasts.error).toEqual(['Not connected to Grasshopper.']);
		expect(state.error).toBeNull();
	});

	// In the Rhino panel the save is Rhino's own dialog, which the user can cancel.
	it('leaves the dialog as it was when the save is cancelled', async () => {
		const { state, deps, toasts, answer } = setup({ saved: false });
		openDialog(state, 'Tower');
		state.key = 'secret';

		const exporting = startExport(state, deps);
		answer({ file: file() });

		expect(await exporting).toBe(false);
		expect(state).toMatchObject({ open: true, key: 'secret', exporting: false, error: null });
		expect(toasts.success).toEqual([]);
	});

	it('keeps an export running through a reopening, without resetting its form', async () => {
		const { state, deps, answer } = setup();
		openDialog(state, 'Tower');
		state.name = 'North tower';
		const exporting = startExport(state, deps);

		closeDialog(state);
		openDialog(state, 'Tower');
		expect(state).toMatchObject({ open: true, name: 'North tower', exporting: true });

		answer({ file: file() });
		await exporting;
	});
});
