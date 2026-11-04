// Pure transition logic for the "Upload to Selva" dialog. No runes, no toast, no socket: every
// handler is a function over a plain SelvaUploadState plus a `deps` bag. useSelvaUpload.svelte.ts
// owns the $state and wires the SelvaSource's events to these.

import type {
	SelvaAccount,
	SelvaTargets,
	SelvaUploadProgress,
	SelvaUploadRequest,
	SelvaUploadResult,
	SelvaVersionTarget
} from '@selvajs/schemas';
import type { SelvaSource } from '#lib/selva-source/selva-source.js';
import type {
	WsSelvaAccountMessage,
	WsSelvaTargetsMessage,
	WsSelvaUploadProgressMessage,
	WsSelvaUploadResultMessage
} from '#lib/websocket/websocket.svelte.js';

export type UploadTarget =
	{ kind: 'newVersion'; definitionGuid: string } | { kind: 'newDefinition' };

export type UploadStage = SelvaUploadProgress['stage'];

export interface UploadForm {
	/** Empty until the user picks one, unless the user can create in exactly one project. */
	projectId: string;
	/** Upload into a new private project named `newProjectName` instead of `projectId`. */
	createProject: boolean;
	newProjectName: string;
	displayName: string;
	description: string;
	category: string;
	tags: string[];
	changeNote: string;
	makeLive: boolean;
}

export interface SelvaUploadState {
	/** The upload dialog. */
	open: boolean;
	/** The Selva connection dialog: instance, sign-in and sign-out. */
	connectionOpen: boolean;
	/** Null until the plugin first answers. */
	account: SelvaAccount | null;
	/** The instance URL field, as typed. */
	originInput: string;
	/** Why the typed instance wasn't sent to the plugin. */
	originError: string | null;
	/** What to send once the plugin accepts the instance the user typed. */
	afterConnect: 'signIn' | 'useApiKey' | null;
	/** Rhino has a dialog open for pasting a key. */
	awaitingKeyDialog: boolean;
	targets: SelvaTargets | null;
	targetsLoading: boolean;
	target: UploadTarget | null;
	form: UploadForm;
	uploading: boolean;
	stage: UploadStage | null;
	result: SelvaUploadResult | null;
}

export interface SelvaUploadNotifier {
	success(message: string): void;
	info(message: string): void;
	warning(message: string): void;
	error(message: string): void;
}

export interface SelvaUploadDeps {
	sessionId: string;
	source: SelvaSource;
	notify: SelvaUploadNotifier;
	/** Compute reads the schema saved in the component, so an unsaved one would go up stale. */
	isSchemaDirty: () => boolean;
}

function emptyForm(): UploadForm {
	return {
		projectId: '',
		createProject: false,
		newProjectName: '',
		displayName: '',
		description: '',
		category: '',
		tags: [],
		changeNote: '',
		makeLive: false
	};
}

export function createInitialSelvaUploadState(): SelvaUploadState {
	return {
		open: false,
		connectionOpen: false,
		account: null,
		originInput: '',
		originError: null,
		afterConnect: null,
		awaitingKeyDialog: false,
		targets: null,
		targetsLoading: false,
		target: null,
		form: emptyForm(),
		uploading: false,
		stage: null,
		result: null
	};
}

// ============================================================================
// Reading targets
// ============================================================================

/** The suggestion first, then the other definitions uploaded from the same document. */
export function versionTargets(targets: SelvaTargets): SelvaVersionTarget[] {
	const suggestion = targets.suggestion;
	if (!suggestion) return targets.matches;
	return [
		suggestion,
		...targets.matches.filter((m) => m.definitionGuid !== suggestion.definitionGuid)
	];
}

/** Upload is offered only for a key Selva accepted in this Rhino session. */
export function uploadAvailable(state: SelvaUploadState): boolean {
	return state.account?.status === 'signedIn' && state.account.verified === true;
}

export function canCreateDefinition(targets: SelvaTargets): boolean {
	return targets.projects.length > 0 || targets.canCreateProjects === true;
}

export function nowhereToUpload(targets: SelvaTargets): boolean {
	return !canCreateDefinition(targets) && versionTargets(targets).length === 0;
}

/** The suggestion is preselected; without one, a new definition if the user may create one. */
export function defaultTarget(targets: SelvaTargets): UploadTarget | null {
	if (targets.suggestion) {
		return { kind: 'newVersion', definitionGuid: targets.suggestion.definitionGuid };
	}
	return canCreateDefinition(targets) ? { kind: 'newDefinition' } : null;
}

export function formFromDefaults(targets: SelvaTargets): UploadForm {
	const { defaults, projects } = targets;
	return {
		...emptyForm(),
		projectId: projects.length === 1 ? projects[0].id : '',
		createProject: projects.length === 0 && targets.canCreateProjects === true,
		displayName: defaults.displayName,
		description: defaults.description ?? '',
		category: defaults.category ?? '',
		tags: [...defaults.tags]
	};
}

export function selectedVersionTarget(state: SelvaUploadState): SelvaVersionTarget | null {
	const target = state.target;
	if (!state.targets || target?.kind !== 'newVersion') return null;
	return (
		versionTargets(state.targets).find((t) => t.definitionGuid === target.definitionGuid) ?? null
	);
}

function isOffered(target: UploadTarget, targets: SelvaTargets): boolean {
	if (target.kind === 'newDefinition') return canCreateDefinition(targets);
	return versionTargets(targets).some((t) => t.definitionGuid === target.definitionGuid);
}

/** `CreateProjectBodySchema` in `@selvajs/server` enforces it too. */
export const PROJECT_NAME_MAX = 128;

/**
 * Why the instance field can't be sent, or null. A pasted key would otherwise travel as a host
 * name to DNS and the system proxy. The plugin checks the same, this saves the round trip.
 */
export function originInputError(input: string): string | null {
	const text = input.trim();
	if (/selva_/i.test(text)) {
		return 'That’s a Selva key, not an address. Sign in with the browser, or use Rhino’s key dialog.';
	}
	let host: string;
	try {
		host = new URL(text.includes('://') ? text : `https://${text}`).hostname;
	} catch {
		return 'That isn’t a web address.';
	}
	const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
	if (!loopback && !host.includes('.') && !host.startsWith('[')) {
		return 'Enter the full address, such as selva.example.com.';
	}
	return null;
}

const SCOPE_ACTIONS: Record<string, string> = {
	write: 'change and delete definitions and projects, and create share links',
	solve: 'run solves on Rhino.Compute'
};

/** What a scope beyond read and upload lets the key do, in words. Unknown scopes come back as is. */
export function describeExtraScope(scope: string): string {
	return SCOPE_ACTIONS[scope.split(':')[0]] ?? scope;
}

// ============================================================================
// Upload checks
// ============================================================================

/** Why Upload can't run right now, or null when it can. */
export function uploadBlocker(state: SelvaUploadState, deps: SelvaUploadDeps): string | null {
	if (!deps.source.connected) return 'Not connected to Grasshopper.';
	if (deps.isSchemaDirty()) return 'Save the schema first.';
	if (!uploadAvailable(state)) return 'Sign in first.';
	if (state.uploading) return 'Already uploading.';
	const targets = state.targets;
	if (!targets) return 'Still checking where you can upload.';
	if (targets.blockedReason) return targets.blockedReason;
	const target = state.target;
	if (!target || !isOffered(target, targets)) return 'Pick where to upload.';
	if (target.kind === 'newDefinition') {
		if (newProjectChosen(state)) {
			const name = state.form.newProjectName.trim();
			if (!name) return 'Name the new project.';
			if (name.length > PROJECT_NAME_MAX) {
				return `Project names are at most ${PROJECT_NAME_MAX} characters.`;
			}
		} else if (!targets.projects.some((p) => p.id === state.form.projectId)) {
			return 'Pick a project.';
		}
		if (!state.form.displayName.trim()) return 'Give the definition a name.';
	}
	return null;
}

function newProjectChosen(state: SelvaUploadState): boolean {
	return state.form.createProject && state.targets?.canCreateProjects === true;
}

/** Carries the instance and key the targets came from, so the plugin can refuse a mismatch. */
export function buildUploadRequest(state: SelvaUploadState): SelvaUploadRequest | null {
	const { target, form, targets } = state;
	if (!target || !targets) return null;
	const echo = { origin: targets.origin, tokenId: targets.tokenId };

	if (target.kind === 'newVersion') {
		const request: SelvaUploadRequest = {
			kind: 'newVersion',
			...echo,
			definitionGuid: target.definitionGuid,
			makeLive: form.makeLive
		};
		const changeNote = form.changeNote.trim();
		if (changeNote) request.changeNote = changeNote;
		return request;
	}

	const request: SelvaUploadRequest = {
		kind: 'newDefinition',
		...echo,
		...(newProjectChosen(state)
			? { newProjectName: form.newProjectName.trim() }
			: { projectId: form.projectId }),
		displayName: form.displayName.trim(),
		tags: [...form.tags],
		makeLive: form.makeLive
	};
	const description = form.description.trim();
	const category = form.category.trim();
	if (description) request.description = description;
	if (category) request.category = category;
	return request;
}

// ============================================================================
// Commands
// ============================================================================

/** Opening always asks afresh: the user may have signed in elsewhere or uploaded since. */
export function openDialog(state: SelvaUploadState, deps: SelvaUploadDeps): void {
	state.open = true;
	if (state.uploading) return;
	state.afterConnect = null;
	state.awaitingKeyDialog = false;
	state.result = null;
	state.stage = null;
	state.targets = null;
	state.targetsLoading = false;
	state.target = null;
	state.form = emptyForm();
	deps.source.getAccount(deps.sessionId);
}

/** An upload keeps running with the dialog closed; its result then arrives as a toast. */
export function closeDialog(state: SelvaUploadState): void {
	state.open = false;
}

/** The plugin checks the key again whenever it's asked for the account and hasn't accepted it yet. */
export function loadAccount(deps: SelvaUploadDeps): void {
	deps.source.getAccount(deps.sessionId);
}

export function openConnection(state: SelvaUploadState, deps: SelvaUploadDeps): void {
	state.connectionOpen = true;
	state.originError = null;
	state.afterConnect = null;
	state.awaitingKeyDialog = false;
	loadAccount(deps);
}

export function closeConnection(state: SelvaUploadState): void {
	state.connectionOpen = false;
}

function connectThen(
	state: SelvaUploadState,
	deps: SelvaUploadDeps,
	next: 'signIn' | 'useApiKey'
): void {
	const origin = state.originInput.trim();
	if (!origin) return;
	state.originError = originInputError(origin);
	if (state.originError) return;
	state.afterConnect = next;
	deps.source.connectInstance(deps.sessionId, origin);
}

export function signIn(state: SelvaUploadState, deps: SelvaUploadDeps): void {
	connectThen(state, deps, 'signIn');
}

export function useApiKey(state: SelvaUploadState, deps: SelvaUploadDeps): void {
	connectThen(state, deps, 'useApiKey');
}

export function signOut(_state: SelvaUploadState, deps: SelvaUploadDeps): void {
	deps.source.signOut(deps.sessionId);
}

/** Stops a sign-in or upload. State changes when the plugin answers, not before. */
export function cancel(_state: SelvaUploadState, deps: SelvaUploadDeps): void {
	deps.source.cancel(deps.sessionId);
}

export function selectTarget(state: SelvaUploadState, target: UploadTarget): void {
	state.target = target;
}

export function startUpload(state: SelvaUploadState, deps: SelvaUploadDeps): boolean {
	if (uploadBlocker(state, deps)) return false;
	const request = buildUploadRequest(state);
	if (!request) return false;
	state.uploading = true;
	state.stage = 'preparing';
	state.result = null;
	deps.source.upload(deps.sessionId, request);
	return true;
}

/** Back from a failed or cancelled upload to the form, as the user left it. */
export function dismissResult(state: SelvaUploadState): void {
	state.result = null;
}

function requestTargets(state: SelvaUploadState, deps: SelvaUploadDeps): void {
	state.targetsLoading = true;
	deps.source.listTargets(deps.sessionId);
}

/** The plugin also blocks when it couldn't list targets at all, so asking again can help. */
export function retryTargets(state: SelvaUploadState, deps: SelvaUploadDeps): void {
	if (!uploadAvailable(state) || state.targetsLoading || state.uploading) return;
	state.targets = null;
	state.target = null;
	requestTargets(state, deps);
}

// ============================================================================
// Plugin messages
// ============================================================================

export function handleAccount(
	state: SelvaUploadState,
	deps: SelvaUploadDeps,
	message: WsSelvaAccountMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	const account = message.account;
	state.account = account;
	state.awaitingKeyDialog = false;

	if (!state.originInput.trim()) {
		state.originInput = account.origin ?? account.knownOrigins[0] ?? '';
	}

	const next = state.afterConnect;
	state.afterConnect = null;
	// The plugin accepted the instance: no message, and still signed out (a token it already
	// holds for that instance would have come back signedIn).
	if (next && account.status === 'signedOut' && account.origin && !account.message) {
		state.originInput = account.origin;
		if (next === 'signIn') {
			deps.source.signIn(deps.sessionId);
		} else {
			deps.source.useApiKey(deps.sessionId);
			state.awaitingKeyDialog = true;
		}
	}

	if (!uploadAvailable(state)) {
		state.targets = null;
		state.targetsLoading = false;
		state.target = null;
		// The connection says why; an upload in flight keeps its dialog to report the result.
		if (state.open && !state.uploading) {
			state.open = false;
			state.connectionOpen = true;
		}
		return;
	}

	const stale = state.targets === null || state.targets.origin !== account.origin;
	if (state.open && !state.uploading && !state.targetsLoading && stale) {
		requestTargets(state, deps);
	}
}

export function handleTargets(
	state: SelvaUploadState,
	deps: SelvaUploadDeps,
	message: WsSelvaTargetsMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	state.targetsLoading = false;

	const targets = message.targets;
	const account = state.account;
	if (!uploadAvailable(state) || targets.origin !== account?.origin) return;

	const firstForThisOpening = state.targets === null;
	state.targets = targets;
	if (firstForThisOpening) state.form = formFromDefaults(targets);
	if (firstForThisOpening || !state.target || !isOffered(state.target, targets)) {
		state.target = defaultTarget(targets);
	}
}

export function handleProgress(
	state: SelvaUploadState,
	deps: SelvaUploadDeps,
	message: WsSelvaUploadProgressMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	if (state.uploading) state.stage = message.progress.stage;
}

export function handleResult(
	state: SelvaUploadState,
	deps: SelvaUploadDeps,
	message: WsSelvaUploadResultMessage
): void {
	if (message.sessionId !== deps.sessionId) return;
	const result = message.result;
	state.uploading = false;
	state.stage = null;
	state.result = result;

	if (state.open) return;
	const name = result.displayName ?? 'the definition';
	if (result.cancelled) {
		deps.notify.info('Upload to Selva cancelled.');
	} else if (result.ok && result.error) {
		deps.notify.warning(`Uploaded ${name} to Selva as the draft. ${result.error}`);
	} else if (result.ok) {
		deps.notify.success(`Uploaded ${name} to Selva.`);
	} else {
		deps.notify.error(`Upload to Selva failed: ${result.error ?? 'no reason given.'}`);
	}
}

/** Only an http(s) URL becomes a link, whatever string the plugin passed on. */
export function safeHttpUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
	} catch {
		return null;
	}
}
