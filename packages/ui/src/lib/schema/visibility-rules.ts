import type {
	LayoutItem,
	VisibilityRule,
	VisibilityCondition,
	GroupVisibilityCondition
} from '@selvajs/schemas';

export interface VisibilityResult {
	visible: boolean;
	disabled: boolean;
	defaultValue?: unknown;
}

type RuleOperatorFn = (a: unknown, b: unknown, values?: unknown[]) => boolean;

const toStringArray = (value: unknown): string[] => {
	if (Array.isArray(value)) return value.map(String);
	if (value === undefined || value === null || value === '') return [];
	return [String(value)];
};

const RULE_OPERATORS: Record<string, RuleOperatorFn> = {
	equals: (a, b) => a === b,
	notEquals: (a, b) => a !== b,
	greaterThan: (a, b) => Number(a) > Number(b),
	lessThan: (a, b) => Number(a) < Number(b),
	greaterThanOrEqual: (a, b) => Number(a) >= Number(b),
	lessThanOrEqual: (a, b) => Number(a) <= Number(b),
	between: (a, _, vals) =>
		vals?.length === 2 && Number(a) >= Number(vals[0]) && Number(a) <= Number(vals[1]),
	in: (a, _, vals) => vals?.includes(String(a)) ?? false,
	notIn: (a, _, vals) => !(vals?.includes(String(a)) ?? false),
	matches: (a, b) => {
		try {
			return new RegExp(String(b)).test(String(a));
		} catch {
			return false;
		}
	},
	contains: (a, b) => toStringArray(a).includes(String(b)),
	containsAny: (a, _, vals) => {
		const arr = toStringArray(a);
		return vals?.some((v) => arr.includes(String(v))) ?? false;
	},
	isEmpty: (a) => toStringArray(a).length === 0,
	isNotEmpty: (a) => toStringArray(a).length > 0
};

export function evaluateRule(rule: VisibilityRule, values: Record<string, unknown>): boolean {
	const fn = RULE_OPERATORS[rule.operator];
	return fn ? fn(values[rule.paramId], rule.value, rule.values) : false;
}

export function evaluateCondition(
	condition: VisibilityCondition | GroupVisibilityCondition,
	values: Record<string, unknown>
): boolean {
	const results = condition.rules.map((rule) => evaluateRule(rule, values));
	return condition.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

type ActionFn = (met: boolean, defaultValue?: unknown) => VisibilityResult;

const ACTIONS: Record<string, ActionFn> = {
	show: (met) => ({ visible: met, disabled: false }),
	hide: (met, dv) => ({ visible: !met, disabled: false, defaultValue: dv }),
	disable: (met, dv) => ({ visible: true, disabled: met, defaultValue: met ? dv : undefined })
};

export function evaluateVisibility(
	item: LayoutItem,
	values: Record<string, unknown>
): VisibilityResult {
	if (item.type === 'linebreak') return { visible: true, disabled: false };
	if ('visible' in item && item.visible === false) {
		return { visible: false, disabled: false };
	}
	if (!item.visibilityCondition?.rules) return { visible: true, disabled: false };

	const { action = 'show', defaultValue } = item.visibilityCondition;
	const met = evaluateCondition(item.visibilityCondition, values);
	const actionFn = ACTIONS[action] ?? ACTIONS.show;

	return actionFn(met, defaultValue);
}

/** Must stay identical to the key the renderers use in their `{#each}` blocks. */
export function itemKey(item: LayoutItem): string {
	return item.type === 'linebreak' ? item.id : item.paramId;
}

/**
 * Evaluates each item once per render. Callers that touch the same item several times
 * (column layout, then cell render, then the default-value sweep) read this map instead of
 * re-evaluating, so they can't disagree about what's visible mid-render.
 */
export function buildVisibilityMap(
	items: LayoutItem[],
	values: Record<string, unknown>
): Record<string, VisibilityResult> {
	const map: Record<string, VisibilityResult> = {};
	for (const item of items) {
		map[itemKey(item)] = evaluateVisibility(item, values);
	}
	return map;
}

export function evaluateGroupVisibility(
	group: { visibilityCondition?: GroupVisibilityCondition },
	values: Record<string, unknown>
): boolean {
	if (!group.visibilityCondition?.rules) return true;

	const { action = 'show' } = group.visibilityCondition;
	const met = evaluateCondition(group.visibilityCondition, values);

	return action === 'hide' ? !met : met;
}
