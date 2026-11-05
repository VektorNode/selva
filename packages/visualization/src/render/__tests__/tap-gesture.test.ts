import { describe, expect, it } from 'vitest';

import { trackTaps } from '../scene-setup/tap-gesture';

function fakeCanvas() {
	const listeners = new Map<string, ((event: unknown) => void)[]>();
	const canvas = {
		addEventListener: (type: string, fn: (event: unknown) => void) => {
			listeners.set(type, [...(listeners.get(type) ?? []), fn]);
		},
		removeEventListener: () => {}
	} as unknown as HTMLCanvasElement;
	const fire = (type: string, event: Record<string, unknown>) => {
		for (const fn of listeners.get(type) ?? []) fn({ type, ...event });
	};
	return { canvas, fire };
}

function finger(pointerId: number, x: number, y: number, timeStamp = 0) {
	return { pointerId, pointerType: 'touch', clientX: x, clientY: y, timeStamp };
}

describe('trackTaps', () => {
	it('counts a short, steady touch as a tap', () => {
		const { canvas, fire } = fakeCanvas();
		const taps = trackTaps(canvas);

		fire('pointerdown', finger(1, 100, 100));
		fire('pointermove', finger(1, 106, 103, 50));
		fire('pointerup', finger(1, 106, 103, 120));

		expect(taps.wasTap()).toBe(true);
	});

	it('rejects an orbit that returns to where it started', () => {
		const { canvas, fire } = fakeCanvas();
		const taps = trackTaps(canvas);

		fire('pointerdown', finger(1, 100, 100));
		fire('pointermove', finger(1, 160, 100, 50));
		fire('pointerup', finger(1, 100, 100, 120));

		expect(taps.wasTap()).toBe(false);
	});

	it('rejects a pinch, however little each finger moved', () => {
		const { canvas, fire } = fakeCanvas();
		const taps = trackTaps(canvas);

		fire('pointerdown', finger(1, 100, 100));
		fire('pointerdown', finger(2, 200, 200, 10));
		fire('pointerup', finger(2, 200, 200, 80));
		fire('pointerup', finger(1, 100, 100, 100));

		expect(taps.wasTap()).toBe(false);
	});

	it('rejects a long press', () => {
		const { canvas, fire } = fakeCanvas();
		const taps = trackTaps(canvas);

		fire('pointerdown', finger(1, 100, 100));
		fire('pointerup', finger(1, 100, 100, 800));

		expect(taps.wasTap()).toBe(false);
	});

	it('rejects a touch the browser cancelled', () => {
		const { canvas, fire } = fakeCanvas();
		const taps = trackTaps(canvas);

		fire('pointerdown', finger(1, 100, 100));
		fire('pointercancel', finger(1, 100, 100, 50));

		expect(taps.wasTap()).toBe(false);
	});

	it('holds a mouse to its tighter slop but not to the long-press limit', () => {
		const { canvas, fire } = fakeCanvas();
		const taps = trackTaps(canvas);
		const mouse = (x: number, timeStamp: number) => ({
			pointerId: 1,
			pointerType: 'mouse',
			clientX: x,
			clientY: 0,
			timeStamp
		});

		fire('pointerdown', mouse(0, 0));
		fire('pointerup', mouse(8, 50));
		expect(taps.wasTap()).toBe(false);

		fire('pointerdown', mouse(0, 0));
		fire('pointerup', mouse(2, 2000));
		expect(taps.wasTap()).toBe(true);
	});
});
