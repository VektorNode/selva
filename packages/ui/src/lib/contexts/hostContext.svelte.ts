import { getContext, setContext } from 'svelte';
import type { GeometryKind } from '@selvajs/schemas';
import type { UIHost } from '$lib/schema/host-support';

// Tells InputControl which host it renders in and how to reach the host's own actions, without
// threading a prop through every layout layer. Without a provider the host is Selva.

export type GeometryPickResult =
	| { outcome: 'picked'; summary: string }
	| { outcome: 'cancelled' }
	| { outcome: 'failed'; error: string };

/** What a pick button can ask for: a Get Geometry filter's kinds, or Get Point/Line/Plane's own. */
export type PickKind = GeometryKind | 'line' | 'plane';

/** What a geometry input lets the user pick, as the host discovered it on the canvas. */
export interface GeometryPickTarget {
	/** The kinds its filter allows; absent when it takes anything. */
	kinds?: readonly GeometryKind[];
	/** 1 picks a single object. */
	atMost?: number;
}

export interface HostActions {
	host: UIHost;
	/** Prompts in the Rhino viewport for a geometry input. The picked geometry stays in Grasshopper. */
	pickGeometry?: (paramId: string) => Promise<GeometryPickResult>;
	/** Empties a geometry input again, back to the definition's own value. */
	clearGeometry?: (paramId: string) => void;
	/**
	 * Reports what the param holds after every pick or clear, including those another page asked
	 * for; null when nothing is picked into it. Returns an unsubscribe.
	 */
	onGeometrySummary?: (paramId: string, listener: (summary: string | null) => void) => () => void;
	describeGeometry?: (paramId: string) => GeometryPickTarget | undefined;
	/** Presses a button input: one solve with `true`, then it goes back to `false`. */
	trigger?: (paramId: string) => void;
}

const SELVA_HOST: HostActions = { host: 'selva' };
const HOST_CONTEXT_KEY = Symbol('host-context');

export function setHostContext(actions: HostActions): void {
	setContext(HOST_CONTEXT_KEY, actions);
}

export function getHostContext(): HostActions {
	return getContext<HostActions | undefined>(HOST_CONTEXT_KEY) ?? SELVA_HOST;
}
