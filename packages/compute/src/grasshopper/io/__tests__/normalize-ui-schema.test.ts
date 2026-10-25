/**
 * The casing normalizer for the `/grasshopper/schema` body.
 *
 * The PascalCase fixtures here are not hypothetical — they are the shape a real
 * compute server returned for every definition in a local store, because
 * `Selva.gha` ILRepack-merges Newtonsoft and compute's own Newtonsoft therefore
 * ignored the `[JsonProperty]` attributes. The user-authored option labels are
 * copied verbatim from that same response.
 */
import { describe, expect, it } from 'vitest';

import { normalizeUISchemaCasing } from '../normalize-ui-schema';

describe('normalizeUISchemaCasing', () => {
	it('canonicalizes top-level structural keys', () => {
		const pascal = {
			Id: 'schema-1',
			SchemaVersion: '2.14.0',
			Inputs: [],
			Outputs: [],
			Layout: { Type: 'tabbed', Tabs: [] }
		};

		expect(normalizeUISchemaCasing(pascal)).toEqual({
			id: 'schema-1',
			schemaVersion: '2.14.0',
			inputs: [],
			outputs: [],
			layout: { type: 'tabbed', tabs: [] }
		});
	});

	it('recurses through arrays of nested records', () => {
		const pascal = {
			Inputs: [{ Id: 'a', ParamType: 'number', InputStructure: 'item', Default: null }]
		};

		expect(normalizeUISchemaCasing(pascal)).toEqual({
			inputs: [{ id: 'a', paramType: 'number', inputStructure: 'item', default: null }]
		});
	});

	it('canonicalizes the full layout nesting down to widget config', () => {
		const pascal = {
			Layout: {
				Type: 'tabbed',
				Tabs: [
					{
						Id: 't1',
						Label: 'Process',
						Groups: [
							{
								Id: 'g1',
								Columns: 3,
								Items: [
									{ Type: 'input', WidgetType: 'number', Config: { Minimum: 1000, StepSize: 1 } }
								]
							}
						]
					}
				]
			}
		};

		const result = normalizeUISchemaCasing(pascal) as unknown as {
			layout: {
				tabs: Array<{ groups: Array<{ items: Array<{ widgetType: string; config: unknown }> }> }>;
			};
		};
		const item = result.layout.tabs[0].groups[0].items[0];

		expect(item.widgetType).toBe('number');
		expect(item.config).toEqual({ minimum: 1000, stepSize: 1 });
	});

	// These are the definition author's dropdown labels: rewriting them changes
	// what the definition solves with.
	it('leaves user-authored option labels untouched', () => {
		const pascal = {
			Layout: {
				Tabs: [
					{
						Groups: [
							{
								Items: [
									{
										WidgetType: 'dropdown',
										Config: {
											Options: {
												'Standart Beschichtung': '0',
												'Aufpr. PvB (mit Rostschutz): mit UV-Best.': '2',
												'Use 10 Elements instead': '10',
												True: '1',
												False: '0'
											}
										}
									}
								]
							}
						]
					}
				]
			}
		};

		const result = normalizeUISchemaCasing(pascal) as unknown as {
			layout: { tabs: Array<{ groups: Array<{ items: Array<{ config: { options: object } }> }> }> };
		};

		expect(result.layout.tabs[0].groups[0].items[0].config.options).toEqual({
			'Standart Beschichtung': '0',
			'Aufpr. PvB (mit Rostschutz): mit UV-Best.': '2',
			'Use 10 Elements instead': '10',
			True: '1',
			False: '0'
		});
	});

	it('leaves defaultOptions and values maps untouched', () => {
		const pascal = {
			Inputs: [
				{ Id: 'a', Values: { 'Option A': '1', True: '0' } },
				{ Id: 'b', Config: { DefaultOptions: { 'Seed Label': '9' } } }
			]
		};

		const result = normalizeUISchemaCasing(pascal) as unknown as {
			inputs: Array<{ values?: object; config?: { defaultOptions: object } }>;
		};

		expect(result.inputs[0].values).toEqual({ 'Option A': '1', True: '0' });
		expect(result.inputs[1].config?.defaultOptions).toEqual({ 'Seed Label': '9' });
	});

	// Option media is keyed by the author's option labels, but each entry is a
	// structural object: the keys stay verbatim, the entries get camelCased.
	it('keeps optionMedia and asset keys but camelCases their entries', () => {
		const pascal = {
			Assets: { a1b2c3: { D: 'M3 3h18' }, Ff00aa: { Img: 'data:image/webp;base64,AA==', W: 192 } },
			Layout: {
				Groups: [
					{
						Items: [
							{
								Config: {
									Options: { Oak: '0' },
									OptionMedia: { Oak: { Icon: 'a1b2c3', IconName: 'lucide:tree-deciduous' } }
								}
							}
						]
					}
				]
			}
		};

		const result = normalizeUISchemaCasing(pascal) as unknown as {
			assets: Record<string, object>;
			layout: { groups: Array<{ items: Array<{ config: { optionMedia: object } }> }> };
		};

		expect(result.assets).toEqual({
			a1b2c3: { d: 'M3 3h18' },
			Ff00aa: { img: 'data:image/webp;base64,AA==', w: 192 }
		});
		expect(result.layout.groups[0].items[0].config.optionMedia).toEqual({
			Oak: { icon: 'a1b2c3', iconName: 'lucide:tree-deciduous' }
		});
	});

	// A dynamic value list is the case where a careless normalizer does real
	// damage: `defaultOptions` holds the author's seed labels, and `targetInputId`
	// is the routing link from the output back to the input it fills. Mangle
	// either and the list silently fills with nothing.
	it('preserves dynamic value list seed labels and routing', () => {
		const pascal = {
			Outputs: [{ Id: 'out-1', Type: 'dynamicValueList', TargetInputId: 'in-1' }],
			Layout: {
				Tabs: [
					{
						Groups: [
							{
								Items: [
									{
										Type: 'input',
										WidgetType: 'dynamicValueList',
										ParamId: 'in-1',
										Config: {
											EmptyBehavior: 'show-empty',
											DisplayAs: 'checklist',
											DefaultOptions: { 'Zone 20': '2', 'Use 10 Elements instead': '10', True: '1' }
										}
									},
									{
										Type: 'output',
										WidgetType: 'dynamicValueList',
										ParamId: 'out-1',
										Config: { TargetInputId: 'in-1' }
									}
								]
							}
						]
					}
				]
			}
		};

		const result = normalizeUISchemaCasing(pascal) as unknown as {
			outputs: Array<{ type: string; targetInputId: string }>;
			layout: {
				tabs: Array<{
					groups: Array<{
						items: Array<{
							widgetType: string;
							config: {
								emptyBehavior?: string;
								displayAs?: string;
								defaultOptions?: Record<string, string>;
								targetInputId?: string;
							};
						}>;
					}>;
				}>;
			};
		};
		const [input, output] = result.layout.tabs[0].groups[0].items;

		// Structural keys canonicalized...
		expect(result.outputs[0]).toEqual({
			id: 'out-1',
			type: 'dynamicValueList',
			targetInputId: 'in-1'
		});
		expect(input.config.emptyBehavior).toBe('show-empty');
		expect(input.config.displayAs).toBe('checklist');
		// ...routing preserved, so computed options still reach the input...
		expect(output.config.targetInputId).toBe('in-1');
		// ...and the author's seed labels are byte-identical.
		expect(input.config.defaultOptions).toEqual({
			'Zone 20': '2',
			'Use 10 Elements instead': '10',
			True: '1'
		});
	});

	it('passes an already-camelCase schema through unchanged', () => {
		const camel = {
			id: 'schema-1',
			schemaVersion: '2.14.0',
			inputs: [{ id: 'a', paramType: 'number' }],
			layout: { type: 'tabbed', tabs: [] }
		};

		expect(normalizeUISchemaCasing(camel)).toEqual(camel);
	});

	it('returns a fresh object rather than mutating the input', () => {
		const pascal = { Inputs: [{ Id: 'a' }] };
		const result = normalizeUISchemaCasing(pascal);

		expect(pascal).toEqual({ Inputs: [{ Id: 'a' }] });
		expect(result).not.toBe(pascal);
	});

	it('handles non-object input without throwing', () => {
		expect(normalizeUISchemaCasing(null)).toBeNull();
		expect(normalizeUISchemaCasing('text')).toBe('text');
		expect(normalizeUISchemaCasing(42)).toBe(42);
	});

	// Must match Newtonsoft's CamelCaseNamingStrategy, or an acronym-prefixed field
	// normalizes to a key no consumer reads — the same silent-undefined failure
	// this module exists to prevent.
	it('lowercases a leading acronym run the way Newtonsoft would', () => {
		expect(
			normalizeUISchemaCasing({ DocumentId: 'x', UVMapping: true, UV: 1, ID: 'y', A: 2 })
		).toEqual({
			documentId: 'x',
			uvMapping: true,
			uv: 1,
			id: 'y',
			a: 2
		});
	});
});

describe('normalizeUISchemaCasing — __proto__ keys', () => {
	it('copies a `__proto__` key as data instead of adopting it as the prototype', () => {
		const out = normalizeUISchemaCasing(
			JSON.parse('{"Inputs":[],"__proto__":{"isAdmin":true,"schemaVersion":999}}')
		) as Record<string, unknown>;

		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect(out.isAdmin).toBeUndefined();
		expect(out.schemaVersion).toBeUndefined();
		expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({
			isAdmin: true,
			schemaVersion: 999
		});
	});
});
