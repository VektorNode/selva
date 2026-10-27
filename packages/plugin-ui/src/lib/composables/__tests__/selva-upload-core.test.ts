import { describe, expect, it } from 'vitest';
import type { SelvaAccount, SelvaTargets, SelvaVersionTarget } from '@selvajs/schemas';
import { createFakeSelvaSource } from '#lib/selva-source/fake-selva-source.js';
import {
	buildUploadRequest,
	cancel,
	createInitialSelvaUploadState,
	describeExtraScope,
	handleAccount,
	handleProgress,
	handleResult,
	handleTargets,
	nowhereToUpload,
	openDialog,
	closeDialog,
	retryTargets,
	safeHttpUrl,
	selectTarget,
	selectedVersionTarget,
	signIn,
	startUpload,
	uploadBlocker,
	useApiKey,
	versionTargets,
	type SelvaUploadDeps,
	type SelvaUploadNotifier
} from '../selva-upload-core';

const SESSION = 's1';
const ORIGIN = 'https://selva.example.com';

function makeNotifier(): SelvaUploadNotifier & { calls: Record<string, string[]> } {
	const calls = {
		success: [] as string[],
		info: [] as string[],
		warning: [] as string[],
		error: [] as string[]
	};
	return {
		calls,
		success: (m) => calls.success.push(m),
		info: (m) => calls.info.push(m),
		warning: (m) => calls.warning.push(m),
		error: (m) => calls.error.push(m)
	};
}

function setup({ dirty = false } = {}) {
	const source = createFakeSelvaSource();
	const notify = makeNotifier();
	const schemaDirty = { value: dirty };
	const state = createInitialSelvaUploadState();
	const deps: SelvaUploadDeps = {
		sessionId: SESSION,
		source,
		notify,
		isSchemaDirty: () => schemaDirty.value
	};
	return { source, notify, schemaDirty, state, deps };
}

function account(overrides: Partial<SelvaAccount> = {}): SelvaAccount {
	return {
		status: 'signedIn',
		origin: ORIGIN,
		host: 'selva.example.com',
		knownOrigins: [ORIGIN],
		user: { email: 'ada@example.com', displayName: 'Ada' },
		org: { id: 'org-1', name: 'Studio' },
		expiresAt: '2026-11-20T12:00:00Z',
		extraScopes: [],
		storage: 'keychain',
		...overrides
	};
}

function versionTarget(overrides: Partial<SelvaVersionTarget> = {}): SelvaVersionTarget {
	return {
		definitionGuid: 'def-1',
		displayName: 'Facade panel',
		projectName: 'Tower',
		latestVersionNumber: 4,
		liveVersionNumber: 3,
		linkedVersionNumber: 3,
		newerVersions: [],
		...overrides
	};
}

function targets(overrides: Partial<SelvaTargets> = {}): SelvaTargets {
	return {
		origin: ORIGIN,
		projects: [
			{ id: 'p-1', name: 'Tower' },
			{ id: 'p-2', name: 'Plaza' }
		],
		suggestion: versionTarget(),
		matches: [versionTarget({ definitionGuid: 'def-2', displayName: 'Facade panel (copy)' })],
		defaults: {
			displayName: 'Facade panel',
			description: 'Panelised facade',
			category: 'Facade',
			tags: ['tower']
		},
		file: { name: 'facade.gh', sizeBytes: 182044 },
		...overrides
	};
}

type Setup = ReturnType<typeof setup>;

function sendAccount({ state, deps }: Setup, a: SelvaAccount, sessionId = SESSION) {
	handleAccount(state, deps, { type: 'selvaAccount', sessionId, account: a });
}

function sendTargets({ state, deps }: Setup, t: SelvaTargets, sessionId = SESSION) {
	handleTargets(state, deps, { type: 'selvaTargets', sessionId, targets: t });
}

/** Open the dialog signed in, with targets listed. */
function ready(t: SelvaTargets = targets(), options: { dirty?: boolean } = {}) {
	const s = setup(options);
	openDialog(s.state, s.deps);
	sendAccount(s, account());
	sendTargets(s, t);
	s.source.sent.length = 0;
	return s;
}

describe('opening the dialog', () => {
	it('asks the plugin for the account', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		expect(s.state.open).toBe(true);
		expect(s.source.sent).toEqual([{ type: 'selvaGetAccount', sessionId: SESSION }]);
	});

	it('lists targets once the account comes back signed in', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(s, account());
		expect(s.source.sent.at(-1)).toEqual({ type: 'selvaListTargets', sessionId: SESSION });
		expect(s.state.targetsLoading).toBe(true);
	});

	it('does not list targets while signed out', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(s, account({ status: 'signedOut', user: undefined, org: undefined }));
		expect(s.source.sent.map((c) => c.type)).toEqual(['selvaGetAccount']);
	});

	it('ignores messages for another session', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(s, account(), 'other');
		expect(s.state.account).toBeNull();
	});

	it('starts fresh on reopen, but keeps an upload in flight on screen', () => {
		const s = ready();
		startUpload(s.state, s.deps);
		closeDialog(s.state);
		openDialog(s.state, s.deps);
		expect(s.state.uploading).toBe(true);
		expect(s.state.targets).not.toBeNull();
		expect(s.source.sent.map((c) => c.type)).toEqual(['selvaUpload']);
	});
});

describe('targets', () => {
	it('preselects the suggestion and fills the form from the defaults', () => {
		const s = ready();
		expect(s.state.target).toEqual({ kind: 'newVersion', definitionGuid: 'def-1' });
		expect(s.state.form).toMatchObject({
			displayName: 'Facade panel',
			description: 'Panelised facade',
			category: 'Facade',
			tags: ['tower'],
			projectId: '',
			makeLive: false
		});
		expect(selectedVersionTarget(s.state)?.displayName).toBe('Facade panel');
	});

	it('preselects a new definition without a suggestion', () => {
		const s = ready(targets({ suggestion: undefined }));
		expect(s.state.target).toEqual({ kind: 'newDefinition' });
	});

	it('preselects nothing when the user can only add versions to matches', () => {
		const s = ready(targets({ suggestion: undefined, projects: [] }));
		expect(s.state.target).toBeNull();
	});

	it('picks the project when there is only one', () => {
		const s = ready(targets({ projects: [{ id: 'p-1', name: 'Tower' }] }));
		expect(s.state.form.projectId).toBe('p-1');
	});

	it('treats explicit nulls from the plugin as absent', () => {
		const withNulls = {
			...targets(),
			suggestion: null,
			defaults: { displayName: 'Facade panel', description: null, category: null, tags: [] }
		} as unknown as SelvaTargets;
		const s = ready(withNulls);
		expect(s.state.target).toEqual({ kind: 'newDefinition' });
		expect(s.state.form.description).toBe('');
		expect(s.state.form.category).toBe('');
	});

	it('ignores targets for an instance the user has left', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(s, account());
		sendTargets(s, targets({ origin: 'https://other.example.com' }));
		expect(s.state.targets).toBeNull();
	});

	it('keeps the user’s edits when the plugin re-sends targets', () => {
		const s = ready();
		selectTarget(s.state, { kind: 'newDefinition' });
		s.state.form.displayName = 'Renamed';
		sendTargets(s, targets());
		expect(s.state.target).toEqual({ kind: 'newDefinition' });
		expect(s.state.form.displayName).toBe('Renamed');
	});

	it('lists the suggestion first and drops it from the matches', () => {
		const t = targets({ matches: [versionTarget(), versionTarget({ definitionGuid: 'def-2' })] });
		expect(versionTargets(t).map((v) => v.definitionGuid)).toEqual(['def-1', 'def-2']);
	});

	it('knows when there is nowhere to upload', () => {
		expect(nowhereToUpload(targets({ projects: [], suggestion: undefined, matches: [] }))).toBe(
			true
		);
		expect(nowhereToUpload(targets({ projects: [], matches: [] }))).toBe(false);
	});

	it('clears targets on sign-out', () => {
		const s = ready();
		sendAccount(s, account({ status: 'signedOut', user: undefined, org: undefined }));
		expect(s.state.targets).toBeNull();
		expect(s.state.target).toBeNull();
	});

	it('stops loading when the plugin finds the sign-in ended instead of listing', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(s, account());
		expect(s.state.targetsLoading).toBe(true);

		sendAccount(s, account({ status: 'signedOut', message: 'Your sign-in expired.' }));
		expect(s.state.targetsLoading).toBe(false);
		expect(s.state.account?.message).toBe('Your sign-in expired.');
	});

	it('lists again on retry and starts the form over', () => {
		const s = ready(
			targets({ projects: [], suggestion: undefined, matches: [], blockedReason: 'Offline.' })
		);
		retryTargets(s.state, s.deps);
		expect(s.source.sent).toEqual([{ type: 'selvaListTargets', sessionId: SESSION }]);
		expect(s.state.targets).toBeNull();

		sendTargets(s, targets());
		expect(s.state.target).toEqual({ kind: 'newVersion', definitionGuid: 'def-1' });
	});

	it('does not retry while a list is already on its way', () => {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(s, account());
		retryTargets(s.state, s.deps);
		expect(s.source.sent.filter((c) => c.type === 'selvaListTargets')).toHaveLength(1);
	});
});

describe('signing in', () => {
	function signedOut() {
		const s = setup();
		openDialog(s.state, s.deps);
		sendAccount(
			s,
			account({
				status: 'signedOut',
				origin: undefined,
				user: undefined,
				org: undefined,
				knownOrigins: ['https://last.example.com']
			})
		);
		s.source.sent.length = 0;
		return s;
	}

	it('prefills the instance field from the last known origin', () => {
		expect(signedOut().state.originInput).toBe('https://last.example.com');
	});

	it('does not overwrite what the user typed', () => {
		const s = signedOut();
		s.state.originInput = 'selva.studio.example';
		sendAccount(s, account({ status: 'signedOut', origin: ORIGIN }));
		expect(s.state.originInput).toBe('selva.studio.example');
	});

	it('connects to the typed instance, then signs in once the plugin accepts it', () => {
		const s = signedOut();
		s.state.originInput = '  selva.example.com ';
		signIn(s.state, s.deps);
		expect(s.source.sent).toEqual([
			{ type: 'selvaConnect', sessionId: SESSION, origin: 'selva.example.com' }
		]);

		sendAccount(s, account({ status: 'signedOut', origin: ORIGIN, user: undefined }));
		expect(s.source.sent.at(-1)).toEqual({ type: 'selvaSignIn', sessionId: SESSION });
		expect(s.state.originInput).toBe(ORIGIN);
	});

	it('stops when the plugin refuses the instance', () => {
		const s = signedOut();
		s.state.originInput = 'http://selva.example.com';
		signIn(s.state, s.deps);
		sendAccount(
			s,
			account({ status: 'signedOut', origin: undefined, message: 'Selva needs https.' })
		);
		expect(s.source.sent.map((c) => c.type)).toEqual(['selvaConnect']);
		expect(s.state.originInput).toBe('http://selva.example.com');
	});

	it('does not sign in again when the plugin already holds a token for the instance', () => {
		const s = signedOut();
		s.state.originInput = ORIGIN;
		signIn(s.state, s.deps);
		sendAccount(s, account());
		expect(s.source.sent.map((c) => c.type)).toEqual(['selvaConnect', 'selvaListTargets']);
	});

	it('sends nothing for an empty instance field', () => {
		const s = signedOut();
		s.state.originInput = '  ';
		signIn(s.state, s.deps);
		expect(s.source.sent).toEqual([]);
	});

	it('asks Rhino for a key and says so until the plugin answers', () => {
		const s = signedOut();
		useApiKey(s.state, s.deps);
		sendAccount(s, account({ status: 'signedOut', origin: 'https://last.example.com' }));
		expect(s.source.sent.at(-1)).toEqual({ type: 'selvaUseApiKey', sessionId: SESSION });
		expect(s.state.awaitingKeyDialog).toBe(true);

		sendAccount(s, account({ extraScopes: ['write:all'] }));
		expect(s.state.awaitingKeyDialog).toBe(false);
	});

	it('cancels through the plugin and waits for its answer', () => {
		const s = signedOut();
		cancel(s.state, s.deps);
		expect(s.source.sent).toEqual([{ type: 'selvaCancel', sessionId: SESSION }]);
	});
});

describe('uploadBlocker', () => {
	it('allows the preselected suggestion', () => {
		const s = ready();
		expect(uploadBlocker(s.state, s.deps)).toBeNull();
	});

	it('blocks while the schema has unsaved changes', () => {
		const s = ready(targets(), { dirty: true });
		expect(uploadBlocker(s.state, s.deps)).toBe('Save the schema first.');
	});

	it('blocks when Grasshopper is not connected', () => {
		const s = ready();
		s.source.setConnected(false);
		expect(uploadBlocker(s.state, s.deps)).toBe('Not connected to Grasshopper.');
	});

	it('blocks with the plugin’s reason', () => {
		const s = ready(targets({ blockedReason: 'The file is over the 50 MB limit.' }));
		expect(uploadBlocker(s.state, s.deps)).toBe('The file is over the 50 MB limit.');
	});

	it('asks for a project and a name for a new definition', () => {
		const s = ready();
		selectTarget(s.state, { kind: 'newDefinition' });
		expect(uploadBlocker(s.state, s.deps)).toBe('Pick a project.');
		s.state.form.projectId = 'p-2';
		s.state.form.displayName = '   ';
		expect(uploadBlocker(s.state, s.deps)).toBe('Give the definition a name.');
		s.state.form.displayName = 'Plaza bench';
		expect(uploadBlocker(s.state, s.deps)).toBeNull();
	});

	it('refuses a target the plugin no longer offers', () => {
		const s = ready();
		selectTarget(s.state, { kind: 'newVersion', definitionGuid: 'gone' });
		expect(uploadBlocker(s.state, s.deps)).toBe('Pick where to upload.');
	});

	it('refuses a new definition without projects to put it in', () => {
		const s = ready(targets({ projects: [] }));
		selectTarget(s.state, { kind: 'newDefinition' });
		expect(uploadBlocker(s.state, s.deps)).toBe('Pick where to upload.');
	});
});

describe('buildUploadRequest', () => {
	it('builds a new version with a trimmed change note', () => {
		const s = ready();
		s.state.form.changeNote = '  Thicker mullions ';
		s.state.form.makeLive = true;
		expect(buildUploadRequest(s.state)).toEqual({
			kind: 'newVersion',
			definitionGuid: 'def-1',
			changeNote: 'Thicker mullions',
			makeLive: true
		});
	});

	it('leaves out an empty change note', () => {
		const s = ready();
		expect(buildUploadRequest(s.state)).toEqual({
			kind: 'newVersion',
			definitionGuid: 'def-1',
			makeLive: false
		});
	});

	it('builds a new definition and leaves out empty fields', () => {
		const s = ready();
		selectTarget(s.state, { kind: 'newDefinition' });
		Object.assign(s.state.form, {
			projectId: 'p-2',
			displayName: ' Plaza bench ',
			description: '',
			category: ' ',
			tags: ['street']
		});
		expect(buildUploadRequest(s.state)).toEqual({
			kind: 'newDefinition',
			projectId: 'p-2',
			displayName: 'Plaza bench',
			tags: ['street'],
			makeLive: false
		});
	});
});

describe('uploading', () => {
	it('sends the request and shows the first stage straight away', () => {
		const s = ready();
		expect(startUpload(s.state, s.deps)).toBe(true);
		expect(s.source.sent).toEqual([
			{
				type: 'selvaUpload',
				sessionId: SESSION,
				request: { kind: 'newVersion', definitionGuid: 'def-1', makeLive: false }
			}
		]);
		expect(s.state.uploading).toBe(true);
		expect(s.state.stage).toBe('preparing');
	});

	it('sends nothing while blocked', () => {
		const s = ready(targets(), { dirty: true });
		expect(startUpload(s.state, s.deps)).toBe(false);
		expect(s.source.sent).toEqual([]);
	});

	it('follows the plugin’s stages, then shows the result', () => {
		const s = ready();
		startUpload(s.state, s.deps);
		handleProgress(s.state, s.deps, {
			type: 'selvaUploadProgress',
			sessionId: SESSION,
			progress: { stage: 'uploading' }
		});
		expect(s.state.stage).toBe('uploading');

		handleResult(s.state, s.deps, {
			type: 'selvaUploadResult',
			sessionId: SESSION,
			result: { ok: true, displayName: 'Facade panel', versionNumber: 5, live: false }
		});
		expect(s.state.uploading).toBe(false);
		expect(s.state.stage).toBeNull();
		expect(s.state.result?.versionNumber).toBe(5);
		expect(s.notify.calls.success).toEqual([]);
	});

	it('ignores progress when nothing is uploading', () => {
		const s = ready();
		handleProgress(s.state, s.deps, {
			type: 'selvaUploadProgress',
			sessionId: SESSION,
			progress: { stage: 'publishing' }
		});
		expect(s.state.stage).toBeNull();
	});

	it('reports a result that arrives with the dialog closed as a toast', () => {
		const s = ready();
		startUpload(s.state, s.deps);
		closeDialog(s.state);
		handleResult(s.state, s.deps, {
			type: 'selvaUploadResult',
			sessionId: SESSION,
			result: { ok: false, live: false, error: 'Compute could not open the file.' }
		});
		expect(s.notify.calls.error).toEqual([
			'Upload to Selva failed: Compute could not open the file.'
		]);
	});

	it('reports an upload whose make-live step failed as a warning, not a failure', () => {
		const s = ready();
		startUpload(s.state, s.deps);
		closeDialog(s.state);
		handleResult(s.state, s.deps, {
			type: 'selvaUploadResult',
			sessionId: SESSION,
			result: {
				ok: true,
				displayName: 'Facade panel',
				versionNumber: 5,
				live: false,
				error: 'Making it live failed.'
			}
		});
		expect(s.notify.calls.error).toEqual([]);
		expect(s.notify.calls.warning).toEqual([
			'Uploaded Facade panel to Selva as the draft. Making it live failed.'
		]);
	});
});

describe('describeExtraScope', () => {
	it('says what write and solve allow, and passes unknown scopes through', () => {
		expect(describeExtraScope('write:all')).toMatch(/delete/);
		expect(describeExtraScope('solve:project:p-1')).toMatch(/solves/);
		expect(describeExtraScope('admin:all')).toBe('admin:all');
	});
});

describe('safeHttpUrl', () => {
	it('passes http and https URLs only', () => {
		expect(safeHttpUrl('https://selva.example.com/library/x')).toBe(
			'https://selva.example.com/library/x'
		);
		expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
		expect(safeHttpUrl('not a url')).toBeNull();
		expect(safeHttpUrl(null)).toBeNull();
	});
});
