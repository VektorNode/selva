import { getContext, onMount, onDestroy, type Component } from 'svelte';
import {
	type FooterStore,
	type FooterItem,
	FOOTER_CONTEXT_KEY
} from '$lib/contexts/footerContext.svelte';

export type FooterItemConfig<P extends Record<string, unknown> = Record<string, unknown>> = Omit<
	FooterItem<P>,
	'position' | 'priority'
> &
	Partial<Pick<FooterItem<P>, 'position' | 'priority'>>;

/**
 * Register a footer item for the lifetime of the calling component.
 *
 * Registration waits for onMount so it never runs during SSR, where reading the context
 * throws. A no-op when no footer context is present (a component rendered outside the root
 * layout) or no component is supplied.
 */
export function useFooterItem<P extends Record<string, unknown>>(config: FooterItemConfig<P>) {
	onMount(() => {
		const store = getContext<FooterStore | undefined>(FOOTER_CONTEXT_KEY);
		if (!store || !config.component) return;
		store.register(config);
	});

	onDestroy(() => {
		try {
			const store = getContext<FooterStore | undefined>(FOOTER_CONTEXT_KEY);
			store?.unregister(config.id);
		} catch {
			// Context may not exist during SSR cleanup: safe to ignore.
		}
	});
}

export type { Component };
