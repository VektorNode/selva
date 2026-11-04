import { untrack } from 'svelte';
import { APP_DEFAULTS } from '../constants';

/**
 * When to show that a solve is running. A solve that ends within `SHOW_AFTER_MS` shows nothing:
 * the result updating is feedback enough, and a spinner that flashes for a frame reads as jank.
 * Once shown, the indicator stays `MIN_VISIBLE_MS` for the same reason. `slow` turns on past
 * `SLOW_AFTER_MS`, the case of a Rhino.Compute round trip or a heavy definition.
 *
 * `freezesDuringSolve` is for a host that can't paint while it solves (an embedded WebView on
 * the solver's thread). A delay can't run there, so the indicator shows on every solve, before
 * the solve takes the thread: it is the only place that host can say Esc aborts.
 */
export function createSolvingIndicator(
	isSolving: () => boolean,
	options: { freezesDuringSolve?: boolean } = {}
): { readonly show: boolean; readonly slow: boolean } {
	const { SHOW_AFTER_MS, MIN_VISIBLE_MS, SLOW_AFTER_MS } = APP_DEFAULTS.SOLVING_INDICATOR;

	if (options.freezesDuringSolve) {
		return {
			// Read straight from `isSolving`, not through an effect: an effect would run a tick
			// later, after the solve has already frozen the page.
			get show() {
				return isSolving();
			},
			slow: false
		};
	}

	let show = $state(false);
	let slow = $state(false);
	let shownAt = 0;
	let showTimer: ReturnType<typeof setTimeout> | null = null;
	let slowTimer: ReturnType<typeof setTimeout> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function clear(timer: ReturnType<typeof setTimeout> | null) {
		if (timer) clearTimeout(timer);
		return null;
	}

	function hide() {
		hideTimer = null;
		show = false;
		slow = false;
	}

	$effect(() => {
		const solving = isSolving();
		untrack(() => {
			if (solving) {
				// A solve that starts while the last one's indicator is held keeps it up.
				hideTimer = clear(hideTimer);
				if (!show) {
					showTimer ??= setTimeout(() => {
						showTimer = null;
						show = true;
						shownAt = performance.now();
					}, SHOW_AFTER_MS);
				}
				slowTimer ??= setTimeout(() => {
					slowTimer = null;
					slow = true;
				}, SLOW_AFTER_MS);
			} else {
				showTimer = clear(showTimer);
				slowTimer = clear(slowTimer);
				if (!show) return;
				const remaining = MIN_VISIBLE_MS - (performance.now() - shownAt);
				if (remaining > 0) hideTimer ??= setTimeout(hide, remaining);
				else hide();
			}
		});
	});

	// Separate from the effect above: a cleanup there would run on every `isSolving` flip and
	// cancel the timers it just set.
	$effect(() => () => {
		clear(showTimer);
		clear(slowTimer);
		clear(hideTimer);
	});

	return {
		get show() {
			return show;
		},
		get slow() {
			return slow;
		}
	};
}
