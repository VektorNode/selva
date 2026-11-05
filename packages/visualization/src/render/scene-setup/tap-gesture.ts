// A `click` alone can't tell a tap from the end of a camera gesture on touch: the browser fires the
// compatibility `mousedown` and `click` together after the finger lifts, both at the lift point, so
// comparing their positions never rejects anything. Pointer events carry the real start, the travel
// in between, and how many fingers took part.

/** A mouse press is precise; past this it was a drag to orbit or pan. */
const MOUSE_SLOP_PX = 5;
/** A fingertip wobbles a few pixels on a deliberate tap. */
const TOUCH_SLOP_PX = 10;
/** A touch held this long was the start of an orbit that never moved, not a tap. */
const TOUCH_LONG_PRESS_MS = 500;

export interface TapTracker {
	/**
	 * Whether the pointer gesture that just ended was a tap: one pointer, held still, released
	 * promptly. Read it from `click`/`dblclick`, which the browser fires after `pointerup`.
	 */
	wasTap(): boolean;
	/** `pointerType` of the gesture that just ended: `mouse`, `touch` or `pen`. */
	pointerType(): string;
	dispose(): void;
}

export function trackTaps(canvas: HTMLCanvasElement): TapTracker {
	const down = new Map<number, { x: number; y: number }>();
	let pointerType = 'mouse';
	let startTime = 0;
	let maxPointers = 0;
	let maxTravel = 0;
	let cancelled = false;
	let lastWasTap = false;

	const travel = (event: PointerEvent) => {
		const start = down.get(event.pointerId);
		if (!start) return;
		maxTravel = Math.max(maxTravel, Math.hypot(event.clientX - start.x, event.clientY - start.y));
	};

	const onDown = (event: PointerEvent) => {
		if (down.size === 0) {
			pointerType = event.pointerType;
			startTime = event.timeStamp;
			maxPointers = 0;
			maxTravel = 0;
			cancelled = false;
		}
		down.set(event.pointerId, { x: event.clientX, y: event.clientY });
		maxPointers = Math.max(maxPointers, down.size);
	};

	const onMove = (event: PointerEvent) => travel(event);

	const onEnd = (event: PointerEvent) => {
		if (!down.has(event.pointerId)) return;
		travel(event);
		if (event.type === 'pointercancel') cancelled = true;
		down.delete(event.pointerId);
		if (down.size > 0) return;

		const isMouse = pointerType === 'mouse';
		lastWasTap =
			!cancelled &&
			maxPointers === 1 &&
			maxTravel <= (isMouse ? MOUSE_SLOP_PX : TOUCH_SLOP_PX) &&
			(isMouse || event.timeStamp - startTime <= TOUCH_LONG_PRESS_MS);
	};

	// Capture phase, so the verdict is in place before any bubble-phase listener reads it.
	const options = { capture: true, passive: true };
	canvas.addEventListener('pointerdown', onDown, options);
	canvas.addEventListener('pointermove', onMove, options);
	canvas.addEventListener('pointerup', onEnd, options);
	canvas.addEventListener('pointercancel', onEnd, options);

	return {
		wasTap: () => lastWasTap,
		pointerType: () => pointerType,
		dispose: () => {
			canvas.removeEventListener('pointerdown', onDown, options);
			canvas.removeEventListener('pointermove', onMove, options);
			canvas.removeEventListener('pointerup', onEnd, options);
			canvas.removeEventListener('pointercancel', onEnd, options);
		}
	};
}
