import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_DEFAULTS } from '../../constants';
import { createSolvingIndicator } from '../solving.svelte';

const { SHOW_AFTER_MS, MIN_VISIBLE_MS, SLOW_AFTER_MS } = APP_DEFAULTS.SOLVING_INDICATOR;

function mount(options?: { freezesDuringSolve?: boolean }) {
	let solving = $state(false);
	let indicator!: ReturnType<typeof createSolvingIndicator>;
	const destroy = $effect.root(() => {
		indicator = createSolvingIndicator(() => solving, options);
	});
	flushSync();
	return {
		indicator,
		destroy,
		setSolving(value: boolean) {
			solving = value;
			flushSync();
		}
	};
}

function advance(ms: number) {
	vi.advanceTimersByTime(ms);
	flushSync();
}

describe('createSolvingIndicator', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows nothing for a solve that ends before the delay', () => {
		const { indicator, setSolving, destroy } = mount();

		setSolving(true);
		advance(SHOW_AFTER_MS - 1);
		setSolving(false);
		advance(SLOW_AFTER_MS);

		expect(indicator.show).toBe(false);
		destroy();
	});

	it('shows after the delay and holds for the minimum time once the solve ends', () => {
		const { indicator, setSolving, destroy } = mount();

		setSolving(true);
		advance(SHOW_AFTER_MS);
		expect(indicator.show).toBe(true);

		setSolving(false);
		advance(MIN_VISIBLE_MS - 1);
		expect(indicator.show).toBe(true);
		advance(1);
		expect(indicator.show).toBe(false);
		destroy();
	});

	it('keeps a held indicator up when the next solve starts', () => {
		const { indicator, setSolving, destroy } = mount();

		setSolving(true);
		advance(SHOW_AFTER_MS);
		setSolving(false);
		setSolving(true);
		advance(MIN_VISIBLE_MS);

		expect(indicator.show).toBe(true);
		destroy();
	});

	it('turns slow past the slow threshold and clears it when hidden', () => {
		const { indicator, setSolving, destroy } = mount();

		setSolving(true);
		advance(SLOW_AFTER_MS - 1);
		expect(indicator.slow).toBe(false);
		advance(1);
		expect(indicator.slow).toBe(true);

		// Up longer than the minimum by now, so it hides as soon as the solve ends.
		setSolving(false);
		expect(indicator.show).toBe(false);
		expect(indicator.slow).toBe(false);
		destroy();
	});

	it('cancels its timers when the owner is destroyed', () => {
		const { indicator, setSolving, destroy } = mount();

		setSolving(true);
		destroy();
		advance(SLOW_AFTER_MS);

		expect(indicator.show).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('shows on every solve, with no delay, for a host that freezes while solving', () => {
		const { indicator, setSolving, destroy } = mount({ freezesDuringSolve: true });

		setSolving(true);
		expect(indicator.show).toBe(true);
		setSolving(false);
		expect(indicator.show).toBe(false);
		expect(indicator.slow).toBe(false);
		destroy();
	});
});
