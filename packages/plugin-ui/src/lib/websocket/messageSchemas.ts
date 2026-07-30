/**
 * Runtime validation for inbound WebSocket messages from the Grasshopper plugin.
 *
 * The schemas here are **wire-format guards**, not domain validators: each one mirrors
 * the shape the UI handlers actually read. The embedded `UISchema` is treated as
 * opaque (`z.unknown()`) — its contract belongs to `@selvajs/schemas`, and
 * forcing a parallel Zod mirror would only add maintenance drift.
 *
 * The motivating bugs:
 *   - `metadataUpdated` once sent a nested `DiscoveredParameters` object instead of
 *     the flat array the UI expected. `forEach` threw a `TypeError`, the dispatcher
 *     swallowed it, and the UI silently froze.
 *   - `parametersAdded` once wrapped its payload under `data:` when the UI read
 *     `availableParams` from the top level. Missing field → `undefined` →
 *     fallback round-trip via `requestInitialData`. No error surfaced.
 *
 * Both classes of bug are caught at the dispatcher boundary by the schemas here.
 * See `docs/development/schema-source-of-truth-plan.md` (Follow-up: wire-contract
 * validation) for the design rationale.
 */

import { z } from 'zod';

// ============================================================================
// Shared envelope
// ============================================================================

const baseEnvelope = z.object({
	type: z.string(),
	sessionId: z.string()
});

// ============================================================================
// Per-message schemas
// ============================================================================

// Newtonsoft's default serializer emits explicit `null` for unset optional
// strings (e.g. `message = null` on BroadcastSchemaSaved). All optional
// fields here use `.nullish()` (= optional + null-tolerant) for that reason —
// the handlers already treat null and undefined the same way.

const initialDataSchema = baseEnvelope.extend({
	type: z.literal('initialData'),
	schema: z.unknown().nullish(),
	schemaHash: z.string().nullish(),
	availableParams: z.unknown().nullish(),
	currentValues: z.record(z.string(), z.unknown()).nullish(),
	outputs: z.record(z.string(), z.unknown()).nullish(),
	isSolving: z.boolean().nullish()
});

const schemaUpdatedSchema = baseEnvelope.extend({
	type: z.literal('schemaUpdated'),
	schema: z.unknown(),
	schemaHash: z.string().nullish(),
	removedIds: z.array(z.string()).nullish()
});

const schemaSaveRejectedSchema = baseEnvelope.extend({
	type: z.literal('schemaSaveRejected'),
	schema: z.unknown(),
	schemaHash: z.string().nullish(),
	reason: z.string().nullish()
});

const schemaSavedSchema = baseEnvelope.extend({
	type: z.literal('schemaSaved'),
	success: z.boolean(),
	message: z.string().nullish()
});

/**
 * `metadataUpdated` carries a **flat array** of per-parameter patches keyed by id.
 * Sending the raw `DiscoveredParameters` shape (with nested `inputs` / `outputs`)
 * was the original wire bug — this schema catches that regression at the boundary.
 */
const metadataChangeEntrySchema = z.object({
	id: z.string(),
	nickname: z.string().nullish(),
	description: z.string().nullish(),
	minimum: z.number().nullish(),
	maximum: z.number().nullish(),
	stepSize: z.number().nullish(),
	options: z.record(z.string(), z.string().nullish()).nullish()
});

const metadataUpdatedSchema = baseEnvelope.extend({
	type: z.literal('metadataUpdated'),
	changedParams: z.array(metadataChangeEntrySchema).nullish()
});

/**
 * `parametersAdded` must carry `availableParams` at the **top level** — wrapping it
 * under `data` (the generic envelope shape) silently breaks the handler. We don't
 * validate the inner `DiscoveredParameters` deeply because the handler tolerates
 * missing inner arrays.
 */
const parametersAddedSchema = baseEnvelope.extend({
	type: z.literal('parametersAdded'),
	availableParams: z.unknown().nullish()
});

const outputsSchema = baseEnvelope.extend({
	type: z.literal('outputs'),
	outputs: z.record(z.string(), z.unknown()).nullish(),
	fileOutputs: z.record(z.string(), z.unknown()).nullish(),
	binaryBatchCount: z.number().nullish(),
	modelUnits: z.string().nullish(),
	// Non-mesh display items (curves/points) ride the envelope as JSON; shape is validated by the
	// compute parser, so here we only assert it's an array when present.
	displayItems: z.array(z.unknown()).nullish()
});

// outputUpdate is currently subscribed by usePreviewState but not broadcast by the
// plugin. Schema kept for symmetry so a future broadcaster doesn't need a parallel
// validator change.
const outputUpdateSchema = baseEnvelope.extend({
	type: z.literal('outputUpdate'),
	outputs: z.record(z.string(), z.unknown()).nullish(),
	fileOutputs: z.record(z.string(), z.unknown()).nullish()
});

const currentValuesSchema = baseEnvelope.extend({
	type: z.literal('currentValues'),
	values: z.record(z.string(), z.unknown())
});

/** Each `SyncChange` is serialized from a C# class — PascalCase property names. */
const syncChangeSchema = z.object({
	ParamId: z.string(),
	ParamNickname: z.string(),
	Field: z.enum(['nickname', 'description']),
	SchemaValue: z.unknown(),
	GHValue: z.unknown(),
	Direction: z.enum(['fromGH', 'toGH'])
});

const syncPreviewSchema = baseEnvelope.extend({
	type: z.literal('syncPreview'),
	fromGH: z.array(syncChangeSchema),
	toGH: z.array(syncChangeSchema)
});

const syncAppliedSchema = baseEnvelope.extend({
	type: z.literal('syncApplied'),
	success: z.boolean(),
	message: z.string().nullish()
});

const solvingStateSchema = baseEnvelope.extend({
	type: z.literal('solvingState'),
	isSolving: z.boolean()
});

const runtimeMessageSchema = baseEnvelope.extend({
	type: z.literal('runtimeMessage'),
	level: z.string(),
	message: z.string(),
	timestamp: z.string().nullish()
});

// `disconnecting` uses the generic `BroadcastMessage` envelope — payload nested
// under `data` — and is handled inline in `handleMessage` before validation kicks
// in. No schema needed.

// ============================================================================
// Dispatcher entry point
// ============================================================================

/**
 * Map of message type → schema. Anything not listed here is forwarded without
 * validation (e.g. server-introduced types that predate this validator). That's
 * deliberate: the validator is opt-in and shouldn't gate previously-working
 * message types.
 */
const schemasByType = {
	initialData: initialDataSchema,
	schemaUpdated: schemaUpdatedSchema,
	schemaSaveRejected: schemaSaveRejectedSchema,
	schemaSaved: schemaSavedSchema,
	metadataUpdated: metadataUpdatedSchema,
	parametersAdded: parametersAddedSchema,
	outputs: outputsSchema,
	outputUpdate: outputUpdateSchema,
	currentValues: currentValuesSchema,
	syncPreview: syncPreviewSchema,
	syncApplied: syncAppliedSchema,
	solvingState: solvingStateSchema,
	runtimeMessage: runtimeMessageSchema
} as const satisfies Record<string, z.ZodTypeAny>;

export type ValidatedMessageType = keyof typeof schemasByType;

export type ValidationResult =
	{ ok: true; message: unknown } | { ok: false; type: string; error: z.ZodError; payload: unknown };

/**
 * Validate an inbound message. Returns the (unchanged) message on success — the
 * dispatcher continues to pass the original object to handlers so that existing
 * TS narrowings remain accurate. On failure, returns the Zod error so the caller
 * can log it and drop the message.
 *
 * Unknown message types pass through unvalidated to preserve forward
 * compatibility with server-side additions.
 */
export function validateInboundMessage(message: unknown): ValidationResult {
	if (!message || typeof message !== 'object' || !('type' in message)) {
		// Caller is expected to short-circuit before reaching here; treat as
		// validation failure so the dispatcher surfaces it.
		return {
			ok: false,
			type: '<missing>',
			error: new z.ZodError([
				{
					code: 'custom',
					message: 'Message is not an object or is missing the `type` field',
					path: [],
					input: message
				}
			]),
			payload: message
		};
	}

	const type = (message as { type: unknown }).type;
	if (typeof type !== 'string') {
		return {
			ok: false,
			type: '<non-string>',
			error: new z.ZodError([
				{
					code: 'invalid_type',
					expected: 'string',
					message: '`type` must be a string',
					path: ['type'],
					input: type
				}
			]),
			payload: message
		};
	}

	const schema = schemasByType[type as ValidatedMessageType];
	if (!schema) {
		return { ok: true, message };
	}

	const result = schema.safeParse(message);
	if (result.success) return { ok: true, message: result.data };
	return { ok: false, type, error: result.error, payload: message };
}
