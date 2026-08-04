import { ComputeError, ErrorCodes } from '@/core/errors';
import { getLogger } from '@/core';
import { isDataTreeDefault } from '../../data-tree/tree-path';
import type {
	BaseInputType,
	BooleanInputType,
	ColorInputType,
	FileInputType,
	GeometryInputType,
	InputParam,
	InputParamSchema,
	NumericInputType,
	TextInputType,
	ValueListInputType
} from '../../types';

/**
 * @internal The input-type parser seam.
 *
 * One adapter per Grasshopper param type. A parser owns EVERYTHING about its
 * type: value coercion, type-specific fields (e.g. numeric step size), the
 * typed-param construction, and its own safe fallback when input is bad. New
 * param types plug in by adding an entry to {@link INPUT_TYPE_PARSERS}.
 *
 * Parsers are pure: they read from a (already-`normalizeDefault`'d) schema and
 * return a typed param. They do not mutate the schema. `parse` throws a
 * {@link ComputeError} on recoverable bad input; the registry boundary
 * catches it and pairs it with `fallback`.
 */
export interface InputTypeParser<T extends InputParam = InputParam> {
	/** Canonical paramType(s) this parser owns, e.g. ['Number','Integer']. */
	readonly types: readonly string[];
	/** Schema (with normalized default) → typed param. Throws on bad input. */
	parse(schema: InputParamSchema, base: BaseInputType): T;
	/** This type's safe fallback param when {@link parse} throws. */
	fallback(schema: InputParamSchema, base: BaseInputType): T;
}

import { applyRounding, getInputStepSize, serverStepSize } from './numeric-rounding';
import {
	booleanTransformer,
	coerceDefault,
	colorTransformer,
	numericTransformer,
	objectTransformer,
	textTransformer
} from './transformers';

// Re-exported for `normalize-default.ts`, which coerces raw defaults before parsing.
export { booleanTransformer, numericTransformer };

function computeNumeric(
	schema: InputParamSchema,
	roundingTolerance = 1e-8
): { default: NumericInputType['default']; stepSize: number } {
	const isIntegerType = schema.paramType === 'Integer';
	const serverStep = serverStepSize(schema);

	// A tree-access default is a DataTreeDefault keyed by branch paths; pass it
	// through untouched (numeric constraints are applied later by TreeBuilder).
	// Without this guard the scalar numericTransformer mangles the tree object to
	// `undefined`, silently dropping a tree-access slider's default. Sharing
	// `isDataTreeDefault` with TreeBuilder guarantees we pass through exactly the
	// values it will treat as trees — no looser, no stricter.
	if (isDataTreeDefault(schema.default)) {
		return {
			default: schema.default as NumericInputType['default'],
			stepSize: serverStep ?? (isIntegerType ? 1 : 0.1)
		};
	}

	// A scalar string default that isn't blank and doesn't parse (locale comma
	// '1,5', 'Infinity', hex, plain junk) is bad input — surface it as a parse
	// error instead of silently collapsing the default to `undefined`. Blank
	// strings still mean "no default" (deliberate, see numericTransformer);
	// array items keep the filter semantics.
	if (
		typeof schema.default === 'string' &&
		schema.default.trim() !== '' &&
		numericTransformer(schema.default) === null
	) {
		throw new ComputeError(
			`Invalid numeric default "${schema.default}" for input "${schema.name || 'unknown'}"`,
			ErrorCodes.VALIDATION_ERROR,
			{ context: { inputName: schema.name, default: schema.default } }
		);
	}

	let value = coerceDefault(schema.default, numericTransformer, true);

	if (isIntegerType) {
		if (Array.isArray(value)) {
			value = value.map((val) => (typeof val === 'number' ? Math.round(val) : val));
		} else if (typeof value === 'number') {
			value = Math.round(value);
		}
		return { default: value as NumericInputType['default'], stepSize: serverStep ?? 1 };
	}

	const firstValue = Array.isArray(value) ? value[0] : value;

	let stepSource: number | undefined;
	if (typeof firstValue === 'number' && Number.isFinite(firstValue) && firstValue !== 0) {
		stepSource = firstValue;
	} else if (
		typeof schema.minimum === 'number' &&
		Number.isFinite(schema.minimum) &&
		schema.minimum !== 0
	) {
		stepSource = schema.minimum;
	} else if (
		typeof schema.maximum === 'number' &&
		Number.isFinite(schema.maximum) &&
		schema.maximum !== 0
	) {
		stepSource = schema.maximum;
	}

	const stepSize =
		serverStep ??
		(stepSource !== undefined ? getInputStepSize(stepSource, roundingTolerance) : 0.1);

	// Apply precision to all numeric values
	let decimalPlaces = 0;
	const stepStr = String(stepSize);
	const expMatch = stepStr.toLowerCase().match(/e(-?\d+)/);
	if (expMatch) {
		decimalPlaces = Math.abs(Number(expMatch[1]));
	} else {
		decimalPlaces = stepStr.split('.')[1]?.length ?? 0;
	}

	if (
		decimalPlaces === 0 &&
		typeof firstValue === 'number' &&
		firstValue !== 0 &&
		Math.abs(firstValue) < 1
	) {
		const inferred = Math.ceil(-Math.log10(Math.abs(firstValue)));
		if (Number.isFinite(inferred) && inferred > 0) {
			decimalPlaces = inferred;
		}
	}

	decimalPlaces = Math.min(Math.max(decimalPlaces, 0), 12);

	if (Array.isArray(value)) {
		value = value.map((val) =>
			typeof val === 'number' ? applyRounding(val, decimalPlaces, roundingTolerance) : val
		);
	} else if (typeof value === 'number') {
		value = applyRounding(value, decimalPlaces, roundingTolerance);
	}

	return { default: value as NumericInputType['default'], stepSize };
}

// ============================================================================
// Parsers — one per type
// ============================================================================

const numericParser: InputTypeParser<NumericInputType> = {
	types: ['Number', 'Integer'],
	parse(schema, base) {
		const { default: def, stepSize } = computeNumeric(schema);
		return {
			...base,
			paramType: schema.paramType as 'Number' | 'Integer',
			minimum: schema.minimum,
			maximum: schema.maximum,
			atLeast: schema.atLeast,
			atMost: schema.atMost,
			stepSize,
			default: def
		};
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		// The safe default must respect the input's own floor: with minimum > 0 a
		// plain 0 would render a slider default below its own range.
		const safeValue =
			typeof schema.minimum === 'number' && Number.isFinite(schema.minimum) && schema.minimum > 0
				? schema.minimum
				: 0;
		return {
			...base,
			paramType: schema.paramType as 'Number' | 'Integer',
			minimum: schema.minimum,
			maximum: schema.maximum,
			atLeast: schema.atLeast,
			atMost: schema.atMost,
			// The parse path always sets a stepSize — the fallback param must too.
			stepSize: serverStepSize(schema) ?? (schema.paramType === 'Integer' ? 1 : 0.1),
			default: isList ? [safeValue] : safeValue
		};
	}
};

const booleanParser: InputTypeParser<BooleanInputType> = {
	types: ['Boolean'],
	parse(schema, base) {
		// Tree-access defaults pass through untouched for TreeBuilder, same
		// rationale as computeNumeric's guard.
		if (isDataTreeDefault(schema.default)) {
			return {
				...base,
				paramType: 'Boolean',
				default: schema.default as BooleanInputType['default']
			};
		}
		const value = coerceDefault(schema.default, booleanTransformer, false);
		// The transformer follows the ValueTransformer contract (null on bad input,
		// never a throw), so bad ARRAY items are filtered like non-string junk —
		// one 'maybe' in ['true','maybe'] no longer aborts the whole array. A bad
		// SCALAR survives coercion verbatim (setUndefinedOnEmpty=false); surface it
		// as a parse error instead of shipping a non-boolean default.
		if (
			value !== undefined &&
			value !== null &&
			typeof value !== 'boolean' &&
			!Array.isArray(value)
		) {
			throw new ComputeError(
				`Invalid boolean default "${String(value)}" for input "${schema.name || 'unknown'}"`,
				ErrorCodes.VALIDATION_ERROR,
				{ context: { inputName: schema.name, default: schema.default } }
			);
		}
		return { ...base, paramType: 'Boolean', default: value as BooleanInputType['default'] };
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		return { ...base, paramType: 'Boolean', default: isList ? [false] : false };
	}
};

const textParser: InputTypeParser<TextInputType> = {
	types: ['Text'],
	parse(schema, base) {
		const value = coerceDefault(schema.default, textTransformer, false);
		return { ...base, paramType: 'Text', default: value as TextInputType['default'] };
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		return { ...base, paramType: 'Text', default: isList ? [''] : '' };
	}
};

const valueListParser: InputTypeParser<ValueListInputType> = {
	types: ['ValueList'],
	parse(schema, base) {
		if (
			!schema.values ||
			typeof schema.values !== 'object' ||
			Object.keys(schema.values).length === 0
		) {
			throw ComputeError.missingValues(schema.nickname || 'unnamed', 'ValueList');
		}

		let defaultValue = schema.default as string | undefined;
		if (schema.default !== undefined && schema.default !== null) {
			// A tree/array-shaped default can't index the values map — `String()`
			// would silently turn it into '[object Object]'. Reject it properly.
			if (typeof schema.default === 'object') {
				throw new ComputeError(
					`ValueList input "${schema.nickname || 'unnamed'}" default is not a string-able value`,
					ErrorCodes.VALIDATION_ERROR,
					{ context: { inputName: schema.name, default: schema.default } }
				);
			}
			const defaultLower = String(schema.default).toLowerCase();
			// Membership is case-insensitive, but downstream lookups (`values[default]`)
			// are not — return the canonical-cased key on a match.
			const match = Object.keys(schema.values).find((key) => key.toLowerCase() === defaultLower);
			if (match !== undefined) {
				defaultValue = match;
			} else {
				// Out-of-range default only warns — it still succeeds (pinned behavior).
				getLogger().warn(
					`ValueList input "${schema.nickname || 'unnamed'}" default value "${schema.default}" is not in available values`
				);
			}
		}

		return {
			...base,
			paramType: 'ValueList',
			values: schema.values as Record<string, string>,
			default: defaultValue
		};
	},
	fallback(schema, base) {
		// A ValueList only falls back when its values map is missing/empty or its
		// default couldn't be interpreted — either way the default can't be
		// validated against the map, so drop it (never fabricate `[undefined]` or
		// keep a value provably absent from an empty map).
		return {
			...base,
			paramType: 'ValueList',
			values: schema.values && typeof schema.values === 'object' ? schema.values : {},
			default: undefined
		};
	}
};

const geometryParser: InputTypeParser<GeometryInputType> = {
	types: ['Geometry'],
	parse(schema, base) {
		const value = coerceDefault(
			schema.default,
			objectTransformer(schema.nickname || 'unnamed'),
			true
		);
		return {
			...base,
			paramType: 'Geometry',
			default: value as GeometryInputType['default']
		};
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		return { ...base, paramType: 'Geometry', default: isList ? [null] : (null as any) };
	}
};

const fileParser: InputTypeParser<FileInputType> = {
	types: ['File'],
	parse(schema, base) {
		const value = coerceDefault(
			schema.default,
			objectTransformer(schema.nickname || 'unnamed'),
			true
		);
		return {
			...base,
			paramType: 'File',
			acceptedFormats: schema.acceptedFormats,
			default: value as FileInputType['default']
		};
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		return { ...base, paramType: 'File', default: isList ? [null] : (null as any) };
	}
};

const colorParser: InputTypeParser<ColorInputType> = {
	types: ['Color'],
	parse(schema, base) {
		const value = coerceDefault(schema.default, colorTransformer, false);
		return { ...base, paramType: 'Color', default: value as ColorInputType['default'] };
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		return { ...base, paramType: 'Color', default: isList ? ['0, 0, 0'] : '0, 0, 0' };
	}
};

// ============================================================================
// Registry
// ============================================================================

const ALL_PARSERS: InputTypeParser[] = [
	numericParser,
	booleanParser,
	textParser,
	valueListParser,
	geometryParser,
	fileParser,
	colorParser
];

/** Registry keyed by canonical paramType. */
export const INPUT_TYPE_PARSERS: ReadonlyMap<string, InputTypeParser> = new Map(
	ALL_PARSERS.flatMap((parser) => parser.types.map((type) => [type, parser] as const))
);

/**
 * The Geometry parser is the registry's fallback for an unknown paramType,
 * matching the old `createSafeDefault` default branch (geometry-shaped null).
 */
export const UNKNOWN_TYPE_FALLBACK: InputTypeParser = geometryParser;
