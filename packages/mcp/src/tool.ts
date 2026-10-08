import { z, type ZodType } from 'zod';
import type { Api } from './client.js';
import type { ErrorHint } from './errors.js';
import { jsonOutput, type ToolOutput } from './output.js';
import type { JsonSchema, OperationIndex } from './spec.js';

export interface ToolContext {
	signal: AbortSignal;
	/** The host's operations, for tools that read the spec at run time. */
	spec: OperationIndex;
}

/** A tool's input, derived from an operation once the spec is known. See `inputFrom`. */
export interface DerivedInput {
	kind: 'derived';
	operationId: string;
	omit: string[];
	extend: Record<string, JsonSchema>;
	required: string[];
}

export interface ToolDefinition<Ops = never, Args = Record<string, unknown>> {
	name: string;
	title?: string;
	/** When to use it, what to call first, what it returns. The model picks tools by this. */
	description: string;
	/** A Zod schema validates and types `args`; JSON Schema and derived inputs pass args through. */
	input: ZodType<Args> | JsonSchema | DerivedInput;
	/** Every operationId `run` may call. Annotations derive from these; `api.call` refuses others. */
	calls: string[];
	run(api: Api<Ops>, args: Args, ctx: ToolContext): Promise<ToolOutput | string>;
	errorHint?: ErrorHint;
}

export function tool<Ops = never, Args = Record<string, unknown>>(
	def: ToolDefinition<Ops, Args>
): ToolDefinition<Ops, Args> {
	return def;
}

/**
 * The input schema of an operation, flattened: path params, query params and
 * JSON body fields side by side. `omit` drops fields the tool fills itself;
 * `extend` adds tool-only ones.
 */
export function inputFrom(
	operationId: string,
	options: { omit?: string[]; extend?: Record<string, JsonSchema>; required?: string[] } = {}
): DerivedInput {
	return {
		kind: 'derived',
		operationId,
		omit: options.omit ?? [],
		extend: options.extend ?? {},
		required: options.required ?? []
	};
}

export interface FromOperationOptions {
	name: string;
	title?: string;
	/** Defaults to the operation's summary, which rarely says enough for a model. */
	description?: string;
	/**
	 * Shapes the success body for the model. With one, the tool takes
	 * `detail: 'full'` to get the raw body instead.
	 */
	shape?: (body: unknown, args: Record<string, unknown>) => ToolOutput | string;
	/** Page size for a paginated operation when the model doesn't pass `limit`. Default 20. */
	limit?: number;
	omit?: string[];
	errorHint?: ErrorHint;
}

const DETAIL: JsonSchema = {
	type: 'string',
	enum: ['summary', 'full'],
	description: '`full` returns the raw response instead of the summary. Default `summary`.'
};

/** One tool calling one operation, its arguments split back into path, query and body. */
export function fromOperation(
	operationId: string,
	options: FromOperationOptions
): ToolDefinition<never, Record<string, unknown>> {
	return {
		name: options.name,
		title: options.title,
		description: options.description ?? '',
		input: inputFrom(operationId, {
			omit: options.omit,
			extend: options.shape ? { detail: DETAIL } : {}
		}),
		calls: [operationId],
		errorHint: options.errorHint,
		async run(api, args, { spec, signal }) {
			const op = spec.get(operationId)!;
			const { detail, ...rest } = args;
			const params: Record<string, string> = {};
			const query: Record<string, unknown> = {};
			const body: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(rest)) {
				if (op.pathParams.includes(key)) params[key] = String(value);
				else if (op.queryParams.some((q) => q.name === key)) query[key] = value;
				else body[key] = value;
			}
			if (op.paginated && query.limit === undefined) query.limit = options.limit ?? 20;

			const result = await api.call(operationId, {
				params,
				query,
				body: op.body ? body : undefined,
				signal
			});
			if (options.shape && detail !== 'full') return options.shape(result, args);
			return jsonOutput(result);
		}
	};
}

/** Binds the host's generated `operations` type once, so each tool needn't repeat it. */
export function toolkit<Ops>() {
	return {
		tool: <Args = Record<string, unknown>>(def: ToolDefinition<Ops, Args>) => def,
		fromOperation: fromOperation as (
			operationId: Extract<keyof Ops, string>,
			options: FromOperationOptions
		) => ToolDefinition<never, Record<string, unknown>>
	};
}

// ============================================================================
// Resolution against the spec
// ============================================================================

export interface ResolvedInput {
	schema: JsonSchema;
	parse(args: unknown): unknown;
}

export function resolveInput(
	input: ToolDefinition<unknown, unknown>['input'],
	spec: OperationIndex
): ResolvedInput {
	if (input instanceof z.ZodType) {
		const schema = z.toJSONSchema(input, { io: 'input', target: 'draft-2020-12' }) as JsonSchema;
		delete schema.$schema;
		return { schema, parse: (args) => input.parse(args) };
	}
	if ((input as DerivedInput).kind === 'derived') {
		return { schema: derive(input as DerivedInput, spec), parse: (args) => args ?? {} };
	}
	return { schema: input as JsonSchema, parse: (args) => args ?? {} };
}

function derive(input: DerivedInput, spec: OperationIndex): JsonSchema {
	const op = spec.get(input.operationId);
	if (!op) throw new Error(`inputFrom: ${input.operationId} is not in the host's OpenAPI document`);
	if (op.multipart) throw new Error(`inputFrom: ${input.operationId} takes multipart, not JSON`);

	const properties: Record<string, JsonSchema> = {};
	const required = new Set<string>(input.required);
	const add = (name: string, schema: JsonSchema) => {
		if (name in properties) {
			throw new Error(`inputFrom: ${input.operationId} has two inputs named \`${name}\``);
		}
		properties[name] = schema;
	};

	for (const name of op.pathParams) {
		add(name, { type: 'string' });
		required.add(name);
	}
	for (const q of op.queryParams) {
		add(q.name, q.description ? { ...q.schema, description: q.description } : q.schema);
	}
	const bodyProps = (op.body?.properties ?? {}) as Record<string, JsonSchema>;
	for (const [name, schema] of Object.entries(bodyProps)) add(name, schema);
	for (const name of (op.body?.required as string[] | undefined) ?? []) required.add(name);

	for (const name of input.omit) {
		delete properties[name];
		required.delete(name);
	}
	Object.assign(properties, input.extend);

	return {
		type: 'object',
		properties,
		...(required.size && { required: [...required] }),
		...(op.body && op.body.additionalProperties === false && { additionalProperties: false })
	};
}

export interface Annotations {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
	openWorldHint: boolean;
}

/** The most permissive of a tool's calls wins: one `solve` makes the whole tool open-world. */
export function annotationsFor(calls: string[], spec: OperationIndex): Annotations {
	const ops = calls.map((id) => spec.get(id)!);
	return {
		readOnlyHint: ops.every((op) => op.scope === 'read'),
		destructiveHint: ops.some((op) => op.method === 'DELETE'),
		idempotentHint: ops.every(
			(op) => op.idempotent || op.method === 'GET' || op.method === 'PUT' || op.method === 'DELETE'
		),
		openWorldHint: ops.some((op) => op.scope === 'solve')
	};
}
