import { getContext, setContext } from 'svelte';

/** Scrolls to something the user went looking for and pulses it, so the eye lands on it. */
export function bringIntoView(el: Element): void {
	el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	el.animate({ boxShadow: ['0 0 0 2px var(--primary)', '0 0 0 2px transparent'] }, 1500);
}

// A section keeps its open state to itself, and the three settings panels sit between it and the
// sidebar that has to open it.
export type SectionOpeners = Map<string, () => void>;

const KEY = Symbol('section-openers');

export function setSectionOpeners(openers: SectionOpeners): void {
	setContext(KEY, openers);
}

export function getSectionOpeners(): SectionOpeners {
	return getContext<SectionOpeners>(KEY);
}
