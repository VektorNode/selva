import { getContext, setContext, type Component } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

/**
 * The store holds a heterogeneous mix of items, so its map widens `P` to
 * `Record<string, unknown>` at the boundary; `register` stays generic over `P` so
 * call sites keep type-checked props.
 */
export interface FooterItem<P extends Record<string, unknown> = Record<string, unknown>> {
	id: string;
	component: Component<P>;
	/**
	 * Re-invoked on every render. Return reactive state (`() => ({ status: s.status })`)
	 * or the footer never updates.
	 */
	getProps: () => P;
	position: 'left' | 'right';
	priority: number;
	onClick?: () => void;
}

export interface FooterStore {
	items: SvelteMap<string, FooterItem>;
	/** `position` defaults to `'left'`, `priority` to `0`. */
	register<P extends Record<string, unknown>>(
		item: Omit<FooterItem<P>, 'position' | 'priority'> &
			Partial<Pick<FooterItem<P>, 'position' | 'priority'>>
	): void;
	unregister(id: string): void;
}

export const FOOTER_CONTEXT_KEY = Symbol('footer-context');

export function initializeFooterContext(): FooterStore {
	const items = new SvelteMap<string, FooterItem>();

	const store: FooterStore = {
		items,
		register(item) {
			const { id, component, getProps, position = 'left', priority = 0, onClick } = item;
			items.set(id, {
				id,
				component: component as Component<Record<string, unknown>>,
				getProps: getProps as () => Record<string, unknown>,
				position,
				priority,
				onClick
			});
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
		throw new Error(
			'useFooter must be called within a component that is a descendant of the root layout'
		);
	}
	return store;
}
