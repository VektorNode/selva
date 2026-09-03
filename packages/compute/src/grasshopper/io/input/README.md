# Input parsers

One raw Grasshopper parameter schema in, one typed `InputParam` out. Rhino Compute reports
parameter metadata with inconsistent casing and loose types; a parser is where all the knowledge
about one param type lives: coercion, type-specific fields, and its own safe fallback.

## Pipeline

```
Raw API Response (PascalCase, inconsistent types)
         ↓
   normalizeDefault (shared: flatten the innerTree default)
         ↓
   INPUT_TYPE_PARSERS registry → the parser for this paramType
         ↓
   parser.parse(schema, base)  (or parser.fallback on bad input)
         ↓
   Strongly-Typed InputParam Union
```

### The parts

- **`input-processors.ts`**: orchestrator. Builds the common `base` fields,
  canonicalizes the `paramType`, runs the shared `normalizeDefault` step, looks
  up one parser in the registry, and calls `parse` (catching failures into
  `fallback`). It owns nothing type-specific: no per-type switch.
- **`normalize-default.ts`**: the shared, type-independent step that flattens a
  raw Grasshopper `innerTree` default into the scalar/array/tree shape parsers
  expect. Runs before type dispatch. Pure.
- **`input-type-parsers.ts`**: the input-type parser seam. One
  `InputTypeParser` adapter per param type, plus the `INPUT_TYPE_PARSERS`
  registry. Each parser owns its coercion, type-specific fields, typed-param
  construction, and its own safe `fallback`.
- **Discriminated union**: `InputParam` ties the parsers' outputs together for
  type safety.

A parser that throws is caught at the registry boundary and paired with its own `fallback`. An
unknown `paramType` falls back to `geometryParser` (`UNKNOWN_TYPE_FALLBACK`).

## Parameter types

Each parser declares the canonical `paramType`(s) it owns via its `types` field
and is registered in `INPUT_TYPE_PARSERS`:

| Parser            | `types`             | Output Type          |
| ----------------- | ------------------- | -------------------- |
| `numericParser`   | `Number`, `Integer` | `NumericInputType`   |
| `textParser`      | `Text`              | `TextInputType`      |
| `booleanParser`   | `Boolean`           | `BooleanInputType`   |
| `valueListParser` | `ValueList`         | `ValueListInputType` |
| `geometryParser`  | `Geometry`          | `GeometryInputType`  |
| `fileParser`      | `File`              | `FileInputType`      |
| `colorParser`     | `Color`             | `ColorInputType`     |

`InputParam` is a discriminated union, so a consumer narrows on `paramType`:

```typescript
for (const input of processInputs(rawApiResponse)) {
	if (input.paramType === 'Number') console.log(input.minimum, input.maximum);
}
```

## Adding a parser

One new adapter plus a registry entry, no edits to `input-processors.ts`.

### 1. Define the type and add it to the union

```typescript
// src/grasshopper/types/inputs.ts
export interface CustomInputType extends BaseInputType {
	paramType: 'Custom';
	customProperty: string;
	default: DefaultValue<CustomType>;
}

export type InputParam =
	| NumericInputType
	| TextInputType
	| CustomInputType // ← add here
	| ...;
```

### 2. Write the parser adapter

A parser implements `InputTypeParser`: it declares the canonical `types` it
owns, a `parse` (happy path, throws a `ComputeError` on recoverable bad
input), and a `fallback` (this type's safe default when `parse` throws). It
reads from an already-`normalizeDefault`'d schema and is pure: it returns a
typed param and never mutates the schema.

```typescript
// filepath: src/grasshopper/io/input/input-type-parsers.ts
const customParser: InputTypeParser<CustomInputType> = {
	types: ['Custom'],
	parse(schema, base) {
		const value = coerceDefault(schema.default, customTransformer, true);
		return {
			...base,
			paramType: 'Custom',
			customProperty: schema.customProperty ?? 'default',
			default: value as CustomInputType['default']
		};
	},
	fallback(schema, base) {
		const isList = (schema.atMost ?? 1) > 1;
		return {
			...base,
			paramType: 'Custom',
			customProperty: 'default',
			default: isList ? [null] : null
		};
	}
};
```

If the default needs flattening that differs by `treeAccess` / `atMost`, that
belongs in the shared `normalize-default.ts`, not here: parsers receive an
already-flattened default.

### 3. Register it

Add the parser to `ALL_PARSERS` in `input-type-parsers.ts`. The registry and
the case-insensitive canonicalization pick it up automatically from its `types`:

```typescript
const ALL_PARSERS: InputTypeParser[] = [
	numericParser,
	// ...
	customParser // ← add here
];
```

## Testing

Test the parser directly through its `parse` interface: the typed param it
returns is the test surface.

```typescript
import { INPUT_TYPE_PARSERS } from '@/grasshopper/io/input/input-type-parsers';
import { createInputSchema } from '@tests/helpers/test-data-builders';

const base = { description: '', name: 'test', nickname: 'T', treeAccess: false, groupName: '' };

describe('customParser', () => {
	it('parses a custom parameter', () => {
		const schema = createInputSchema({ paramType: 'Custom', customProperty: 'value' } as any);
		const result = INPUT_TYPE_PARSERS.get('Custom')!.parse(schema, base) as any;
		expect(result.paramType).toBe('Custom');
		expect(result.customProperty).toBe('value');
	});
});
```

Also add a case to `process-inputs.characterization.test.ts` so the end-to-end
pipeline behavior (including your fallback on bad input) is pinned.

## Rules a parser must keep

- **Pure.** Read the schema, return a typed param, never mutate.
- **Own your fallback.** It is this type's safe default; don't push it into the orchestrator.
- **Throw `ComputeError` for recoverable bad input.** The registry pairs it with your fallback.
- **Leave tree-flattening to `normalizeDefault`.** It is shared and type-independent.
- **Expect missing fields.** API responses drop them.
