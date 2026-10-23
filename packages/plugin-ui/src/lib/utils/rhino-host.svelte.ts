import { RHINO_HOST_CONTAINER_EVENT } from '$lib/app.config';
import { isRhinoPanel } from './session';

type HostWindow = Window & { __selvaHostContainer?: string };

function readContainer(value: unknown): 'panel' | 'window' {
	return value === 'window' ? 'window' : 'panel';
}

/**
 * Where the Rhino host shows the page: its panel (docked or floating) or its own pop-out window.
 * The host sets `window.__selvaHostContainer` and fires the event after every move and page load;
 * until it has, the page is in the panel, where every session starts.
 */
class RhinoHostContainer {
	current = $state<'panel' | 'window'>('panel');

	constructor() {
		if (typeof window === 'undefined') return;
		this.current = readContainer((window as HostWindow).__selvaHostContainer);
		window.addEventListener(RHINO_HOST_CONTAINER_EVENT, (event) => {
			this.current = readContainer((event as CustomEvent<string>).detail);
		});
	}
}

export const rhinoHostContainer = new RhinoHostContainer();

/** In the Rhino panel rather than a browser tab or the pop-out window. */
export function isInRhinoPanel(): boolean {
	return isRhinoPanel() && rhinoHostContainer.current === 'panel';
}

/**
 * AppShell props for any Rhino host. Rhino's own appearance decides light or dark, so there's no
 * toggle, and the footer drops the copyright line it has no width for.
 */
export function rhinoShellProps(): { showModeToggle?: boolean; footerText?: string } {
	return isRhinoPanel() ? { showModeToggle: false, footerText: '' } : {};
}
