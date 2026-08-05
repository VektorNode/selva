import { describe, expect, it } from 'vitest';
import {
	evaluateRule,
	evaluateVisibility,
	evaluateGroupVisibility,
	buildVisibilityMap,
	itemKey
} from './visibility-rules';
import type { GroupVisibilityCondition, LayoutItem, VisibilityRule } from '@selvajs/schemas';

// These tests pin the non-obvious branches: operator edge cases that are easy to
// break in a refactor, and the action/short-circuit precedence in evaluateVisibility.
// Trivial passthroughs (equals true === true) are omitted on purpose.

// `operator` is widened to string so tests can exercise the unknown-operator path.
function rule(partial: {
	operator: string;
	paramId: string;
	value?: unknown;
	values?: unknown[];
}): VisibilityRule {
	return partial as unknown as VisibilityRule;
}

describe('evaluateRule — operator edge cases', () => {
	it('between requires exactly two values and is inclusive', () => {
		const r = rule({ operator: 'between', paramId: 'x', values: [10, 20] });
		expect(evaluateRule(r, { x: 10 })).toBe(true); // lower bound inclusive
		expect(evaluateRule(r, { x: 20 })).toBe(true); // upper bound inclusive
		expect(evaluateRule(r, { x: 21 })).toBe(false);
		// Wrong arity must fail closed, not throw or pass.
		expect(evaluateRule(rule({ operator: 'between', paramId: 'x', values: [10] }), { x: 15 })).toBe(
			false
		);
	});

	it('matches returns false for an invalid regex instead of throwing', () => {
		const r = rule({ operator: 'matches', paramId: 'x', value: '(' });
		expect(evaluateRule(r, { x: 'anything' })).toBe(false);
	});

	it('contains / containsAny coerce scalars and arrays through toStringArray', () => {
		// scalar value is treated as a single-element array
		expect(evaluateRule(rule({ operator: 'contains', paramId: 'x', value: '5' }), { x: 5 })).toBe(
			true
		);
		expect(
			evaluateRule(rule({ operator: 'containsAny', paramId: 'x', values: ['a', 'b'] }), {
				x: ['b', 'c']
			})
		).toBe(true);
	});

	it('isEmpty treats empty string, null, and [] as empty but not a non-empty value', () => {
		const empty = rule({ operator: 'isEmpty', paramId: 'x' });
		expect(evaluateRule(empty, { x: '' })).toBe(true);
		expect(evaluateRule(empty, { x: null })).toBe(true);
		expect(evaluateRule(empty, { x: [] })).toBe(true);
		expect(evaluateRule(empty, { x: '0' })).toBe(false);
	});

	it('unknown operator fails closed', () => {
		expect(evaluateRule(rule({ operator: 'definitelyNotAnOp', paramId: 'x' }), { x: 1 })).toBe(
			false
		);
	});
});

describe('evaluateVisibility — action & short-circuit precedence', () => {
	const condition = {
		rules: [{ operator: 'equals', paramId: 'mode', value: 'advanced' }],
		mode: 'all'
	};

	it('explicit visible:false beats any visibility condition', () => {
		const item = {
			type: 'input',
			paramId: 'p',
			visible: false,
			visibilityCondition: { ...condition, action: 'show' }
		} as unknown as LayoutItem;
		// Condition is met, but visible:false wins.
		expect(evaluateVisibility(item, { mode: 'advanced' })).toEqual({
			visible: false,
			disabled: false
		});
	});

	it('hide action inverts visibility and only carries defaultValue', () => {
		const item = {
			type: 'input',
			paramId: 'p',
			visibilityCondition: { ...condition, action: 'hide', defaultValue: 7 }
		} as unknown as LayoutItem;
		expect(evaluateVisibility(item, { mode: 'advanced' })).toEqual({
			visible: false,
			disabled: false,
			defaultValue: 7
		});
		expect(evaluateVisibility(item, { mode: 'basic' }).visible).toBe(true);
	});

	it('disable action keeps item visible and only applies defaultValue when the condition is met', () => {
		const item = {
			type: 'input',
			paramId: 'p',
			visibilityCondition: { ...condition, action: 'disable', defaultValue: 'X' }
		} as unknown as LayoutItem;
		expect(evaluateVisibility(item, { mode: 'advanced' })).toEqual({
			visible: true,
			disabled: true,
			defaultValue: 'X'
		});
		expect(evaluateVisibility(item, { mode: 'basic' })).toEqual({
			visible: true,
			disabled: false,
			defaultValue: undefined
		});
	});

	it('item without a condition is visible and enabled', () => {
		const item = { type: 'input', paramId: 'p' } as unknown as LayoutItem;
		expect(evaluateVisibility(item, {})).toEqual({ visible: true, disabled: false });
	});
});

describe('buildVisibilityMap', () => {
	const cond = {
		rules: [{ operator: 'equals', paramId: 'mode', value: 'advanced' }],
		mode: 'all'
	};

	it('keys each item by paramId (inputs/outputs) or id (linebreak) and matches evaluateVisibility', () => {
		const items = [
			{ type: 'input', paramId: 'a' },
			{ type: 'linebreak', id: 'lb1' },
			{
				type: 'input',
				paramId: 'b',
				visibilityCondition: { ...cond, action: 'show' }
			}
		] as unknown as LayoutItem[];
		const values = { mode: 'basic' };

		const map = buildVisibilityMap(items, values);
		expect(map.a).toEqual(evaluateVisibility(items[0], values));
		expect(map.lb1).toEqual(evaluateVisibility(items[1], values));
		// 'b' shows only when mode === 'advanced'; here it's hidden.
		expect(map.b.visible).toBe(false);
		expect(map.b).toEqual(evaluateVisibility(items[2], values));
	});

	it('itemKey returns paramId for controls and id for linebreaks', () => {
		expect(itemKey({ type: 'input', paramId: 'p1' } as unknown as LayoutItem)).toBe('p1');
		expect(itemKey({ type: 'linebreak', id: 'lb' } as unknown as LayoutItem)).toBe('lb');
	});
});

describe('evaluateGroupVisibility', () => {
	it('hide action inverts, show is the default, no condition means visible', () => {
		const cond = (action?: string): { visibilityCondition: GroupVisibilityCondition } => ({
			visibilityCondition: {
				action,
				mode: 'all',
				rules: [{ operator: 'equals', paramId: 'show', value: true }]
			} as unknown as GroupVisibilityCondition
		});
		expect(evaluateGroupVisibility(cond('hide'), { show: true })).toBe(false);
		expect(evaluateGroupVisibility(cond('show'), { show: true })).toBe(true);
		expect(evaluateGroupVisibility(cond(), { show: true })).toBe(true);
		expect(evaluateGroupVisibility({}, {})).toBe(true);
	});
});
