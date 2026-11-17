import { describe, expect, it } from 'vitest';

import type { Point3 } from '../../model/curve.js';
import {
	constrainPoint,
	formatLength,
	parseTypedInput,
	type ConstrainOptions
} from '../constraints.js';

const free: ConstrainOptions = {
	last: null,
	snapped: false,
	ortho: false,
	gridStep: 0,
	typed: null
};

const expectPoint = (actual: Point3, expected: Point3) => {
	for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
};

describe('parseTypedInput', () => {
	it('reads a length, an angle, or both', () => {
		expect(parseTypedInput('1250')).toEqual({ length: 1250 });
		expect(parseTypedInput('<45')).toEqual({ angle: 45 });
		expect(parseTypedInput('2,5<-30')).toEqual({ length: 2.5, angle: -30 });
		expect(parseTypedInput('100<')).toEqual({ length: 100 });
	});

	it('rejects what it cannot read', () => {
		for (const text of ['', '<', '-5', '0', '1..2', '10<20<30', '-']) {
			expect(parseTypedInput(text)).toBeNull();
		}
	});
});

describe('constrainPoint', () => {
	it('leaves a free point alone', () => {
		expect(constrainPoint([1.2, 3.4, 0], free)).toEqual([1.2, 3.4, 0]);
	});

	it('rounds to the grid, unless the point sits on a vertex', () => {
		expect(constrainPoint([12, 26, 0], { ...free, gridStep: 5 })).toEqual([10, 25, 0]);
		expect(constrainPoint([12, 26, 0], { ...free, gridStep: 5, snapped: true })).toEqual([
			12, 26, 0
		]);
	});

	it('locks to the nearest 45 degrees and follows the cursor along it', () => {
		const last: Point3 = [10, 10, 2];
		expectPoint(constrainPoint([20, 11, 0], { ...free, last, ortho: true }), [20, 10, 2]);
		expectPoint(constrainPoint([20, 19, 0], { ...free, last, ortho: true }), [19.5, 19.5, 2]);
	});

	it('sets a typed length along the cursor direction', () => {
		const last: Point3 = [0, 0, 0];
		expectPoint(constrainPoint([3, 4, 0], { ...free, last, typed: { length: 10 } }), [6, 8, 0]);
	});

	it('sets a typed angle, with the cursor giving the length', () => {
		const last: Point3 = [1, 1, 0];
		expectPoint(constrainPoint([4, 5, 0], { ...free, last, typed: { angle: 90 } }), [1, 6, 0]);
		expectPoint(
			constrainPoint([9, 9, 0], { ...free, last, typed: { length: 2, angle: 180 } }),
			[-1, 1, 0]
		);
	});

	it('ignores typed values on the first point', () => {
		expect(constrainPoint([3, 4, 0], { ...free, typed: { length: 10 } })).toEqual([3, 4, 0]);
	});
});

describe('formatLength', () => {
	it('keeps about three significant digits', () => {
		expect(formatLength(1250, 'mm')).toBe('1250 mm');
		expect(formatLength(12.54)).toBe('12.5');
		expect(formatLength(0.03456, 'm')).toBe('0.0346 m');
		expect(formatLength(0)).toBe('0');
	});
});
