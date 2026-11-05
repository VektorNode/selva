import { getContext, setContext } from 'svelte';

/** Scrolls to something the user went looking for and pulses it, so the eye lands on it. */
export function bringIntoView(el: Element): void {
	el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	el.animate({ boxShadow: ['0 0 0 2px var(--primary)', '0 0 0 2px transparent'] }, 1500);
}

/**
 * Tints a placed card's background and fades it back, to show what just landed. Reduced motion
 * gets the same tint switched on and off with no fade.
 */
export function flashPlaced(el: Element): void {
	const card = el.querySelector('[data-slot="card"]') ?? el;
	const rest = getComputedStyle(card).backgroundColor;
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	card.animate(
		{ backgroundColor: [`color-mix(in oklab, var(--primary) 18%, ${rest})`, rest] },
		{ duration: 1200, easing: reduce ? 'steps(1, jump-end)' : 'ease-out' }
	);
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
