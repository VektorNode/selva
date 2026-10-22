import { ComputeError, ErrorCodes, type ErrorCode } from '@/core/errors';
import { getLogger } from '@/core';
import { isDataTreeDefault } from '../../data-tree/tree-path';
import { applyRounding, decimalsOf, getInputStepSize, serverStepSize } from './numeric-rounding';
import {
	booleanTransformer,
	coerceDefault,
	colorTransformer,
	numericTransformer,
	objectTransformer,
	textTransformer
} from './transformers';
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
 * A recoverable oddity a parser found while still succeeding (e.g. a ValueList
 * default not in its values map). Reaches clients through `parseErrors`.
 */
export interface ParserWarning {
	code: ErrorCode;
	message: string;
}

/**
 * One adapter per Grasshopper param type: value coercion, type-specific fields
 * and the typed param. Pure: reads a `normalizeDefault`'d schema, never mutates it.
 */
export interface InputTypeParser<T extends InputParam = InputParam> {
	/** Throws a {@link ComputeError} on bad input; calls `warn` for oddities it recovered from. */
	parse(schema: InputParamSchema, base: BaseInputType, warn?: (warning: ParserWarning) => void): T;
	/** The safe param when {@link parse} throws. Omit it when `parse` can't throw. */
	fallback?(schema: InputParamSchema, base: BaseInputType): T;
}

const listOr = <T>(schema: InputParamSchema, value: T): T | T[] =>
	(schema.atMost ?? 1) > 1 ? [value] : value;

const defaultStep = (schema: InputParamSchema): number =>
	serverStepSize(schema) ?? (schema.paramType === 'Integer' ? 1 : 0.1);

const mapNumbers = (value: unknown, fn: (n: number) => number): unknown =>
	Array.isArray(value)
		? value.map((v) => (typeof v === 'number' ? fn(v) : v))
		: typeof value === 'number'
			? fn(value)
			: value;

function computeNumeric(schema: InputParamSchema): {
	default: NumericInputType['default'];
	stepSize: number;
} {
	// A tree default passes through: TreeBuilder applies the numeric constraints.
	if (isDataTreeDefault(schema.default)) {
		return {
			default: schema.default as NumericInputType['default'],
			stepSize: defaultStep(schema)
		};
	}

	// A non-blank string that doesn't parse ('1,5', 'Infinity', hex) is an error,
	// not a silent `undefined`. Blank still means "no default".
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

	const value = coerceDefault(schema.default, numericTransformer, true);

	if (schema.paramType === 'Integer') {
		return {
			default: mapNumbers(value, Math.round) as NumericInputType['default'],
			stepSize: defaultStep(schema)
		};
	}

	const firstValue = Array.isArray(value) ? value[0] : value;
	const stepSource = [firstValue, schema.minimum, schema.maximum].find(
		(v): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0
	);
	const stepSize =
		serverStepSize(schema) ?? (stepSource !== undefined ? getInputStepSize(stepSource) : 0.1);

	let decimalPlaces = decimalsOf(stepSize);
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

	return {
		default: mapNumbers(value, (n) =>
			applyRounding(n, decimalPlaces)
		) as NumericInputType['default'],
		stepSize
	};
}

const numericParser: InputTypeParser<NumericInputType> = {
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
		// With minimum > 0, a plain 0 would sit below the slider's own range.
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
			stepSize: defaultStep(schema),
			default: listOr(schema, safeValue)
		};
	}
};

const booleanParser: InputTypeParser<BooleanInputType> = {
	parse(schema, base) {
		if (isDataTreeDefault(schema.default)) {
			return {
				...base,
				paramType: 'Boolean',
				default: schema.default as BooleanInputType['default']
			};
		}
		const value = coerceDefault(schema.default, booleanTransformer, false);
		// A bad array item is filtered; a bad scalar survives coercion verbatim
		// (dropInvalidScalar=false) and is reported here instead.
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
		return { ...base, paramType: 'Boolean', default: listOr(schema, false) };
	}
};

const textParser: InputTypeParser<TextInputType> = {
	parse(schema, base) {
		const value = coerceDefault(schema.default, textTransformer, false);
		return { ...base, paramType: 'Text', default: value as TextInputType['default'] };
	}
};

const valueListParser: InputTypeParser<ValueListInputType> = {
	parse(schema, base, warn) {
		if (
			!schema.values ||
			typeof schema.values !== 'object' ||
			Object.keys(schema.values).length === 0
		) {
			const inputName = schema.nickname || 'unnamed';
			throw new ComputeError(
				`Input "${inputName}" has no values defined (expected ValueList)`,
				ErrorCodes.INVALID_INPUT,
				{ context: { inputName, expectedType: 'ValueList' } }
			);
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
				// Out-of-range only warns: the parse still succeeds.
				const message = `ValueList input "${schema.nickname || 'unnamed'}" default value "${schema.default}" is not in available values`;
				getLogger().warn(message);
				warn?.({ code: ErrorCodes.VALIDATION_ERROR, message });
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
		// The default can't be validated against the map here, so drop it.
		return {
			...base,
			paramType: 'ValueList',
			values: schema.values && typeof schema.values === 'object' ? schema.values : {},
			default: undefined
		};
	}
};

function geometryFallback(schema: InputParamSchema, base: BaseInputType): GeometryInputType {
	return {
		...base,
		paramType: 'Geometry',
		default: listOr(schema, null) as GeometryInputType['default']
	};
}

const geometryParser: InputTypeParser<GeometryInputType> = {
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
	fallback: geometryFallback
};

const fileParser: InputTypeParser<FileInputType> = {
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
	}
};

const colorParser: InputTypeParser<ColorInputType> = {
	parse(schema, base) {
		const value = coerceDefault(schema.default, colorTransformer, false);
		return { ...base, paramType: 'Color', default: value as ColorInputType['default'] };
	}
};

/** Keyed by canonical paramType. */
export const INPUT_TYPE_PARSERS: ReadonlyMap<string, InputTypeParser> = new Map<
	string,
	InputTypeParser
>([
	['Number', numericParser],
	['Integer', numericParser],
	['Boolean', booleanParser],
	['Text', textParser],
	['ValueList', valueListParser],
	['Geometry', geometryParser],
	['File', fileParser],
	['Color', colorParser]
]);

export const unknownTypeFallback = geometryFallback;
