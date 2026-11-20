import type { ViewInput } from '@selvajs/mcp';
import {
	getGroups,
	getLayoutItems,
	type GroupConfig,
	type InputLayoutItem,
	type LayoutItem,
	type SchemaInput,
	type UISchema,
	type VisibilityCondition
} from '@selvajs/schemas';

interface DescribedInput {
	input: SchemaInput;
	item?: InputLayoutItem;
	label: string;
}

export function describeInputs(schema: UISchema): DescribedInput[] {
	const items = getLayoutItems(schema).filter((i): i is InputLayoutItem => i.type === 'input');
	return schema.inputs.map((input) => {
		const item = items.find((i) => i.paramId === input.id);
		return { input, item, label: item?.displayName || input.nickname };
	});
}

function optionsOf(item?: InputLayoutItem): Record<string, string | undefined> | undefined {
	if (!item) return undefined;
	if (item.widgetType === 'dropdown') return item.config?.options;
	if (item.widgetType === 'dynamicValueList') return item.config?.defaultOptions;
	return undefined;
}

function unitOf(item?: InputLayoutItem): string | undefined {
	return item?.widgetType === 'number' ? item.config?.unit || undefined : undefined;
}

// ============================================================================
// The form as text, for the model
// ============================================================================

const OPERATORS: Record<string, string> = {
	equals: 'is',
	notEquals: 'is not',
	greaterThan: '>',
	lessThan: '<',
	greaterThanOrEqual: '≥',
	lessThanOrEqual: '≤',
	in: 'is one of',
	notIn: 'is none of',
	between: 'is between',
	matches: 'matches',
	contains: 'contains',
	containsAny: 'contains any of',
	isEmpty: 'is empty',
	isNotEmpty: 'is not empty'
};

/** "shown only when "Shape" is "Round"", in the labels the model sees. */
function conditionText(
	condition: Pick<VisibilityCondition, 'mode' | 'rules' | 'action'> | undefined,
	labelOf: (id: string) => string
): string | undefined {
	if (!condition?.rules?.length) return undefined;
	const rules = condition.rules.map((r) => {
		const operator = OPERATORS[r.operator] ?? r.operator;
		const value = r.values ?? r.value;
		const shown = value === undefined ? '' : ` ${JSON.stringify(value)}`;
		return `"${labelOf(r.paramId)}" ${operator}${shown}`;
	});
	const joined = rules.join(condition.mode === 'any' ? ' or ' : ' and ');
	const action = condition.action ?? 'show';
	if (action === 'hide') return `hidden when ${joined}`;
	if (action === 'disable') return `disabled when ${joined}`;
	return `shown only when ${joined}`;
}

function inputLine(
	{ input, item, label }: DescribedInput,
	labelOf: (id: string) => string,
	filledBy: (id: string) => string[]
): string {
	const parts = [`- "${label}" (id ${input.id}): ${input.paramType}`];
	if (input.inputStructure && input.inputStructure !== 'item')
		parts.push(`, ${input.inputStructure} of them`);
	if (item?.widgetType === 'number') {
		const { minimum, maximum, stepSize } = item.config ?? {};
		if (minimum !== undefined || maximum !== undefined)
			parts.push(`, ${minimum ?? '…'} to ${maximum ?? '…'}`);
		if (stepSize !== undefined) parts.push(`, step ${stepSize}`);
	}
	const unit = unitOf(item);
	if (unit) parts.push(`, in ${unit}`);
	if (item?.widgetType === 'text' && item.config?.maxLength) {
		parts.push(`, at most ${item.config.maxLength} characters`);
	}
	if (item?.widgetType === 'checkbox' && item.config?.displayAs === 'button') {
		parts.push(', a button: true runs it once');
	}
	const options = optionsOf(item);
	if (item?.widgetType === 'dynamicValueList') {
		const sources = filledBy(input.id);
		parts.push(
			', its options are computed in the solve' +
				(sources.length ? ` by ${sources.map((s) => `"${s}"`).join(', ')}` : '') +
				' and can change with other inputs; selva_solve lists them'
		);
		if (options && Object.keys(options).length)
			parts.push(
				`; before a solve: ${Object.keys(options)
					.map((k) => `"${k}"`)
					.join(', ')}`
			);
	} else if (options)
		parts.push(
			`, one of: ${Object.keys(options)
				.map((k) => `"${k}"`)
				.join(', ')}`
		);
	if (input.default !== undefined) parts.push(`, default ${JSON.stringify(input.default)}`);
	const condition = conditionText(item?.visibilityCondition, labelOf);
	if (condition) parts.push(`, ${condition}`);
	if (item?.visible === false) parts.push(', hidden in the form');
	const description = item?.description || input.description;
	if (description) parts.push(`. ${description}`);
	return parts.join('');
}

function outputLine(schema: UISchema, item: LayoutItem | undefined, id: string): string | null {
	const output = schema.outputs.find((o) => o.id === id);
	if (!output) return null;
	const label = (item && 'displayName' in item && item.displayName) || output.nickname;
	const name =
		label === output.nickname ? `"${label}"` : `"${output.nickname}" (shown as ${label})`;
	const description =
		(item && 'description' in item && (item.description as string | undefined)) ||
		output.description;
	return `- ${name}: ${output.type}${description ? `. ${description}` : ''}`;
}

/**
 * Inputs and outputs under their form groups, each group with its description, so the model
 * reads them as a person filling the form would.
 */
export function formText(schema: UISchema): string[] {
	const described = describeInputs(schema);
	const labelOf = (id: string) => described.find((d) => d.input.id === id)?.label ?? id;
	const filledBy = (id: string) =>
		schema.outputs
			.filter((o) => o.type === 'dynamicValueList' && o.targetInputId === id)
			.map((o) => o.nickname);
	const line = (d: DescribedInput) => inputLine(d, labelOf, filledBy);
	const lines: string[] = [];
	const placedInputs = new Set<string>();
	const placedOutputs = new Set<string>();

	const groupBlock = (group: GroupConfig) => {
		const inputs: string[] = [];
		const outputs: string[] = [];
		for (const item of group.items ?? []) {
			if (item.type === 'input' && item.paramId) {
				const d = described.find((x) => x.input.id === item.paramId);
				if (!d) continue;
				placedInputs.add(d.input.id);
				inputs.push(line(d));
			} else if (item.type === 'output' && item.paramId) {
				const line = outputLine(schema, item, item.paramId);
				if (!line) continue;
				placedOutputs.add(item.paramId);
				outputs.push(line);
			}
		}
		if (!inputs.length && !outputs.length) return;
		const condition = conditionText(group.visibilityCondition, labelOf);
		lines.push('', `## ${group.label || 'Untitled group'}${condition ? ` (${condition})` : ''}`);
		if (group.description) lines.push(group.description);
		if (inputs.length) lines.push('Inputs:', ...inputs);
		if (outputs.length) lines.push('Outputs:', ...outputs);
	};
	for (const group of getGroups(schema)) groupBlock(group);

	const looseInputs = described.filter((d) => !placedInputs.has(d.input.id));
	if (looseInputs.length) {
		lines.push('', '## Not on the form', 'Inputs:', ...looseInputs.map(line));
	}
	const looseOutputs = schema.outputs
		.filter((o) => !placedOutputs.has(o.id))
		.map((o) => outputLine(schema, undefined, o.id)!);
	if (looseOutputs.length) lines.push('', 'Other outputs:', ...looseOutputs);
	if (schema.outputs.some((o) => o.type === 'dynamicValueList')) {
		lines.push(
			'',
			'Some lists are computed in the solve: what they offer depends on other inputs, and an ' +
				'output can repeat an input once per row (a cabinet, a bay). selva_solve returns each ' +
				"list's options and the pick it used; an input repeated per row takes an object of row " +
				'key to option name.'
		);
	}
	return lines;
}

// ============================================================================
// Values the model gives, to what the solve takes
// ============================================================================

/** Values keyed by what the model saw: label, nickname or id. Dropdown labels become their values. */
export function resolveValues(
	described: DescribedInput[],
	given: Record<string, unknown>
): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	const unknown: string[] = [];
	for (const [key, value] of Object.entries(given)) {
		const byId = described.find((d) => d.input.id === key);
		const byName = described.filter((d) => d.label === key || d.input.nickname === key);
		if (!byId && byName.length > 1) {
			const ids = byName.map((d) => d.input.id).join(', ');
			throw new Error(`"${key}" names more than one input; pass one of their ids: ${ids}.`);
		}
		const match = byId ?? byName[0];
		if (!match) {
			unknown.push(key);
			continue;
		}
		const options = optionsOf(match.item);
		const pick = (v: unknown) =>
			typeof v === 'string' && options && Object.hasOwn(options, v) && options[v] !== undefined
				? options[v]
				: v;
		// A repeated input takes one pick per row, sent as a JSON string of row key to pick.
		values[match.input.id] = Array.isArray(value)
			? value.map(pick)
			: typeof value === 'object' && value !== null
				? JSON.stringify(
						Object.fromEntries(Object.entries(value).map(([row, v]) => [row, pick(v)]))
					)
				: pick(value);
	}
	if (unknown.length) {
		const known = described.map((d) => `"${d.label}"`).join(', ');
		throw new Error(`No input named ${unknown.map((k) => `"${k}"`).join(', ')}. Inputs: ${known}.`);
	}
	return values;
}

// ============================================================================
// The form as controls, for the 3D view
// ============================================================================

/**
 * One control per single-value input the view can edit, keyed by label as `selva_solve` takes
 * them, holding `given` where the model set it and the default otherwise. Geometry, files,
 * colours and lists stay as the definition has them.
 */
export function viewInputs(schema: UISchema, given: Record<string, unknown>): ViewInput[] {
	const inputs: ViewInput[] = [];
	for (const d of describeInputs(schema)) {
		const { input, item, label } = d;
		if (input.inputStructure && input.inputStructure !== 'item') continue;
		if (item?.visible === false) continue;
		const value =
			given[label] ?? given[input.nickname] ?? given[input.id] ?? (input.default as unknown);
		const description = item?.description || input.description || undefined;
		const options = optionsOf(item);
		if (options) {
			const names = Object.keys(options);
			// The default is stored as the option's value; the view shows its name.
			const name = names.find((n) => n === value) ?? names.find((n) => options[n] === value);
			inputs.push({ name: label, kind: 'choice', options: names, value: name, description });
			continue;
		}
		if (input.paramType === 'number' || input.paramType === 'integer') {
			const config = item?.widgetType === 'number' ? item.config : undefined;
			inputs.push({
				name: label,
				kind: 'number',
				value,
				min: config?.minimum,
				max: config?.maximum,
				step: config?.stepSize ?? (input.paramType === 'integer' ? 1 : undefined),
				unit: config?.unit || undefined,
				description
			});
		} else if (input.paramType === 'boolean') {
			if (item?.widgetType === 'checkbox' && item.config?.displayAs === 'button') continue;
			inputs.push({ name: label, kind: 'boolean', value: value === true, description });
		} else if (input.paramType === 'text') {
			inputs.push({ name: label, kind: 'text', value, description });
		}
	}
	return inputs;
}
