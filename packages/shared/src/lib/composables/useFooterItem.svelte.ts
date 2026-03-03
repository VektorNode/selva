import { onMount, onDestroy } from 'svelte';
import { useFooter } from '$lib/contexts/footerContext.svelte';

/**
 * Register a footer item component that reactively updates its props.
 * The `getProps` function is called on every render, so returning reactive state
 * (e.g. `() => ({ status: myState.status })`) will keep the footer in sync.
 *
 * Registration is deferred to onMount (client-side only) to avoid SSR context errors.
 *
 * @param id        - Unique identifier for this footer item
 * @param component - Svelte component to render
 * @param getProps  - Function returning current props (called reactively)
 * @param position  - Where to display ('left' or 'right'), defaults to 'left'
 * @param priority  - Higher values render first within their position
 * @param onClick   - Optional click handler (e.g. open a popup/dialog)
 */
export function useFooterItem(
	id: string,
	component: any,
	getProps: () => Record<string, any>,
	position: 'left' | 'right' = 'left',
	priority: number = 0,
	onClick?: () => void
) {
	onMount(() => {
		const footer = useFooter();
		footer.register(id, component, getProps, position, priority, onClick);
	});

	onDestroy(() => {
		try {
			const footer = useFooter();
			footer.unregister(id);
		} catch {
			// Context may not exist during SSR cleanup — safe to ignore
		}
	});
}
