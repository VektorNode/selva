// Reactive shell over selva-upload-core.ts: owns the $state, subscribes the SelvaSource's events
// to the pure handlers, and exposes the commands the dialog calls.

import { untrack } from 'svelte';
import { toast } from '@selvajs/ui';
import { getWebSocketPortFromUrl } from '$lib/utils/session';
import { getGrasshopperSelvaSource } from '$lib/selva-source/grasshopper-selva-source';
import type { SelvaSource } from '$lib/selva-source/selva-source';
import {
	createInitialSelvaUploadState,
	openDialog,
	closeDialog,
	openConnection,
	closeConnection,
	loadAccount,
	uploadAvailable,
	signIn,
	useApiKey,
	signOut,
	cancel,
	selectTarget,
	startUpload,
	dismissResult,
	retryTargets,
	uploadBlocker,
	handleAccount,
	handleTargets,
	handleProgress,
	handleResult,
	type SelvaUploadDeps,
	type UploadTarget
} from './selva-upload-core';

interface Options {
	isSchemaDirty: () => boolean;
	/** Defaults to the Grasshopper socket on the URL's wsPort. */
	source?: SelvaSource;
}

export function useSelvaUpload(sessionId: string, options: Options) {
	const source = options.source ?? getGrasshopperSelvaSource(getWebSocketPortFromUrl());
	const state = $state(createInitialSelvaUploadState());

	const deps: SelvaUploadDeps = {
		sessionId,
		source,
		notify: toast,
		isSchemaDirty: options.isSchemaDirty
	};

	const onAccount = (m: Parameters<typeof handleAccount>[2]) => handleAccount(state, deps, m);
	const onTargets = (m: Parameters<typeof handleTargets>[2]) => handleTargets(state, deps, m);
	const onProgress = (m: Parameters<typeof handleProgress>[2]) => handleProgress(state, deps, m);
	const onResult = (m: Parameters<typeof handleResult>[2]) => handleResult(state, deps, m);

	let subscribed = false;
	let stopWatching: (() => void) | null = null;

	function initialize() {
		if (subscribed) return;
		subscribed = true;
		source.on('selvaAccount', onAccount);
		source.on('selvaTargets', onTargets);
		source.on('selvaUploadProgress', onProgress);
		source.on('selvaUploadResult', onResult);
		// The header offers Upload only once the plugin says Selva took the key, so ask on every
		// (re)connect: a command sent before the socket is up is lost.
		stopWatching = $effect.root(() => {
			$effect(() => {
				if (source.connected) untrack(() => loadAccount(deps));
			});
		});
	}

	function cleanup() {
		if (!subscribed) return;
		subscribed = false;
		source.off('selvaAccount', onAccount);
		source.off('selvaTargets', onTargets);
		source.off('selvaUploadProgress', onProgress);
		source.off('selvaUploadResult', onResult);
		stopWatching?.();
		stopWatching = null;
	}

	return {
		get state() {
			return state;
		},
		get connected() {
			return source.connected;
		},
		get blocker() {
			return uploadBlocker(state, deps);
		},
		get available() {
			return uploadAvailable(state);
		},
		open: () => openDialog(state, deps),
		close: () => closeDialog(state),
		openConnection: () => openConnection(state, deps),
		closeConnection: () => closeConnection(state),
		signIn: () => signIn(state, deps),
		useApiKey: () => useApiKey(state, deps),
		signOut: () => signOut(state, deps),
		cancel: () => cancel(state, deps),
		selectTarget: (target: UploadTarget) => selectTarget(state, target),
		upload: () => startUpload(state, deps),
		dismissResult: () => dismissResult(state),
		retryTargets: () => retryTargets(state, deps),
		initialize,
		cleanup
	};
}

export type SelvaUpload = ReturnType<typeof useSelvaUpload>;
