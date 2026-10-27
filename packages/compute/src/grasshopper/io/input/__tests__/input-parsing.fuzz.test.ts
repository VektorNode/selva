import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { processInputWithError } from '@/grasshopper/io/input/input-processors';
import { decimalsOf, getInputStepSize } from '@/grasshopper/io/input/numeric-rounding';
import type { InputParamSchema } from '@/grasshopper/types';

// FUZZ_RUNS=20000 for a deep run; the default keeps CI fast.
const RUNS = { numRuns: Number(process.env.FUZZ_RUNS ?? 300) };

const PARAM_TYPES = [
	'Number',
	'Integer',
	'Boolean',
	'Text',
	'ValueList',
	'valueList',
	'Geometry',
	'File',
	'Color',
	'Curve',
	''
];

const loose = fc.oneof(
	fc.double(),
	fc.integer(),
	fc.string(),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined)
);

// The DataTree shape the plugin sends, with junk where values go.
const innerTree = fc.record({
	innerTree: fc.dictionary(
		fc.oneof(fc.constant('{0}'), fc.constant('{0;1}'), fc.string()),
		fc.array(
			fc.record({ type: fc.oneof(fc.constant('System.Double'), fc.string()), data: loose }),
			{ maxLength: 3 }
		),
		{ maxKeys: 3 }
	)
});

const schema: fc.Arbitrary<InputParamSchema> = fc.record({
	id: fc.uuid(),
	name: fc.string(),
	nickname: fc.option(fc.string()),
	description: fc.string(),
	paramType: fc.constantFrom(...PARAM_TYPES),
	treeAccess: fc.boolean(),
	minimum: fc.option(fc.double()),
	maximum: fc.option(fc.double()),
	atLeast: fc.integer(),
	atMost: fc.integer(),
	stepSize: fc.option(fc.double(), { nil: undefined }),
	default: fc.oneof(loose, fc.array(loose, { maxLength: 4 }), innerTree, fc.jsonValue()),
	values: fc.option(fc.dictionary(fc.string(), fc.string(), { maxKeys: 4 }), { nil: undefined }),
	acceptedFormats: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
	groupName: fc.option(fc.string())
});

describe('processInputWithError under arbitrary schemas', () => {
	// Its contract: bad input becomes a reported error and a safe default; only a
	// bug throws.
	it('never throws', () => {
		fc.assert(
			fc.property(schema, (raw) => {
				processInputWithError(raw);
			}),
			RUNS
		);
	});

	it('only ever hands out a usable step size', () => {
		fc.assert(
			fc.property(schema, (raw) => {
				const step = (processInputWithError(raw).input as { stepSize?: unknown }).stepSize;
				if (step !== undefined) expect(Number.isFinite(step) && (step as number) > 0).toBe(true);
			}),
			RUNS
		);
	});
});

describe('decimalsOf', () => {
	// A value typed with d decimals must never read as having more: past 1e4,
	// `toFixed(12)` used to print the float's own noise and step became 1e-12.
	it('never counts float noise as decimals', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 6 }), fc.integer({ min: -1e9, max: 1e9 }), (d, k) => {
				const x = Number((k / 10 ** d).toFixed(d));
				expect(decimalsOf(x)).toBeLessThanOrEqual(d);
			}),
			RUNS
		);
	});

	it('gives every finite value a positive, finite step', () => {
		fc.assert(
			fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
				const step = getInputStepSize(x);
				expect(Number.isFinite(step) && step > 0).toBe(true);
			}),
			RUNS
		);
	});
});
