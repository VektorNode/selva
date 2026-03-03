import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export interface FooterItem {
	id: string;
	component: any;
	/** Called on every render — return reactive state to keep footer in sync */
	getProps: () => Record<string, any>;
	position: 'left' | 'right';
	priority: number;
	onClick?: () => void;
}

export interface FooterStore {
	items: SvelteMap<string, FooterItem>;
	register(
		id: string,
		component: any,
		getProps: () => Record<string, any>,
		position?: 'left' | 'right',
		priority?: number,
		onClick?: () => void
	): void;
	unregister(id: string): void;
}

const FOOTER_CONTEXT_KEY = Symbol('footer-context');

export function initializeFooterContext(): FooterStore {
	const items = new SvelteMap<string, FooterItem>();

	const store: FooterStore = {
		items,
		register(id, component, getProps, position = 'left', priority = 0, onClick) {
			items.set(id, { id, component, getProps, position, priority, onClick });
		},
		unregister(id) {
			items.delete(id);
		}
	};

	setContext(FOOTER_CONTEXT_KEY, store);
	return store;
}

export function useFooter(): FooterStore {
	const store = getContext<FooterStore | undefined>(FOOTER_CONTEXT_KEY);
	if (!store) {
		throw new Error('useFooter must be called within a component that is a descendant of the root layout');
	}
	return store;
}
