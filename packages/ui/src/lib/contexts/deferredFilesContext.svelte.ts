import { getContext, setContext } from 'svelte';
import type { DeferredFiles } from '@selvajs/solve/client';

// Carries the session's deferred files down to OutputDisplay without threading a prop through
// every layout layer. A host without a session (the plugin's builder preview) sets nothing, and
// every file output shows what arrived with the solve.

export interface DeferredFilesContext {
	readonly files: DeferredFiles;
	/** A preview is running, so the result on screen is about to be replaced. */
	readonly isSolving: boolean;
	make(): Promise<void>;
	cancel(): void;
}

const DEFERRED_FILES_CONTEXT_KEY = Symbol('deferred-files-context');

export function setDeferredFilesContext(ctx: DeferredFilesContext): void {
	setContext(DEFERRED_FILES_CONTEXT_KEY, ctx);
}

export function getDeferredFilesContext(): DeferredFilesContext | undefined {
	return getContext<DeferredFilesContext | undefined>(DEFERRED_FILES_CONTEXT_KEY);
}
